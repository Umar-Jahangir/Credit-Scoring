import User from "../models/User.js";
import LoanApplication from "../models/LoanApplication.js";
import BorrowerProfile from "../models/BorroweProfile.js";
import { sendLoanSubmittedEmail } from "../services/emailService.js";
import { predictCreditScoreWithModel } from "../services/mlService.js";
import { validateAlternateDataPayload } from "../services/alternateUnderwritingEngine.js";
import { runUnbankedScoringPipeline } from "../services/alternateScoringPipeline.js";

const DEFAULT_EDUCATION = "Secondary / secondary special";

const STATUS_DISPLAY_MAP = {
  pending: "Under Review",
  under_review: "Under Review",
  review: "Under Review",
  hold: "Under Review",
  processing: "Under Review",
  auto_approved: "Approved",
  approved: "Approved",
  accepted: "Approved",
  disbursed: "Approved",
  ongoing: "Approved",
  completed: "Approved",
  closed: "Approved",
  rejected: "Rejected",
  declined: "Rejected",
  auto_rejected: "Auto Rejected",
};

const LOAN_TYPE_PREFIX = {
  personal: "P",
  home: "H",
  auto: "A",
  education: "E",
  business: "B",
  credit_card: "C",
};

async function generateLoanCode(loanType) {
  const prefix = LOAN_TYPE_PREFIX[loanType] || "X";
  const countForType = await LoanApplication.countDocuments({ loanType });
  return `${prefix}${countForType + 1}`;
}

function getLoanDisplayStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return STATUS_DISPLAY_MAP[normalized] || "Under Review";
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function deriveIncomeTypeFromOccupation(occupation) {
  const value = String(occupation || "").toLowerCase();
  if (value.includes("student")) return "Student";
  if (value.includes("self") || value.includes("business"))
    return "Commercial associate";
  if (value.includes("retired")) return "Pensioner";
  if (value.includes("government") || value.includes("state"))
    return "State servant";
  return "Working";
}

function normalizeRiskLevel(level) {
  const value = String(level || "medium").toLowerCase();
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "medium";
}

function normalizeApplicantType(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "unbanked" ? "unbanked" : "banked";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function summarizeMlError(error) {
  const raw = String(error?.message || "ml_inference_error");
  if (raw.includes("No module named 'shap'")) return "ml_dependency_missing:shap";
  if (raw.includes("No module named 'xgboost'")) return "ml_dependency_missing:xgboost";
  if (raw.toLowerCase().includes("timed out")) return "ml_timeout";
  if (raw.toLowerCase().includes("invalid ml_runner output")) return "ml_invalid_output";
  return "ml_inference_failed";
}

function buildUserDecisionExplanation({
  decision,
  applicantType,
  preScreen,
  alternateUnderwriting,
}) {
  const flags = Array.isArray(preScreen?.flags) ? preScreen.flags : [];
  const reasons = [];
  const nextSteps = [];

  if (decision?.riskLevel === "high") reasons.push("Risk level is currently high.");
  if (decision?.probabilityOfDefault >= 0.5) {
    reasons.push("Estimated default probability is elevated.");
  }
  if (flags.includes("loan_to_income_high") || flags.includes("loan_to_income_extreme")) {
    reasons.push("Requested amount is high relative to current income profile.");
    nextSteps.push("Apply for a smaller amount or longer tenure to reduce EMI burden.");
  }
  if (flags.includes("identity_unverified")) {
    reasons.push("Identity could not be fully verified.");
    nextSteps.push("Upload a clear ID document and complete verification.");
  }
  if (flags.includes("high_amount_without_collateral")) {
    reasons.push("High amount requested without collateral support.");
    nextSteps.push("Add collateral details or reduce requested amount.");
  }

  if (applicantType === "unbanked" && alternateUnderwriting) {
    if (alternateUnderwriting.reliabilityFlag === "insufficient_data") {
      reasons.push("Alternate data is insufficient for a confident decision.");
      nextSteps.push("Add at least 6 months of UPI or utility payment history.");
    }
    if ((alternateUnderwriting.warnings || []).includes("high_cashflow_variance")) {
      reasons.push("Cashflow pattern appears irregular.");
      nextSteps.push("Provide stable monthly inflow records and regular payment evidence.");
    }
  }

  if (!reasons.length) {
    reasons.push("Application needs manual verification before final decision.");
  }
  if (!nextSteps.length) {
    nextSteps.push("Keep profile and income details updated, then re-apply.");
  }

  const isRejected = decision?.decision === "Reject" || decision?.status === "auto_rejected";
  const title = isRejected ? "Why your loan was not approved" : "Why your loan is under review";
  const summary = isRejected
    ? "Your application did not meet current risk checks. You can improve and re-apply."
    : "Your application is promising but needs a few more checks before final approval.";

  return {
    title,
    summary,
    reasons: reasons.slice(0, 4),
    nextSteps: nextSteps.slice(0, 4),
  };
}

function inferUserCategory({
  borrowerProfile,
  applicationInput = {},
  loanType,
}) {
  const borrowerType = String(
    borrowerProfile?.borrowerType || ""
  ).toLowerCase();
  const occupation = String(applicationInput?.occupation || "").toLowerCase();

  if (borrowerType.includes("farmer") || occupation.includes("farmer"))
    return "farmer";
  if (
    borrowerType.includes("gig") ||
    occupation.includes("gig") ||
    occupation.includes("delivery") ||
    occupation.includes("driver")
  ) {
    return "gig_worker";
  }
  if (
    borrowerType.includes("daily") ||
    occupation.includes("daily") ||
    occupation.includes("wage") ||
    occupation.includes("labour")
  ) {
    return "daily_wage_worker";
  }
  if (
    borrowerType.includes("msme") ||
    borrowerType.includes("business") ||
    occupation.includes("business") ||
    loanType === "business"
  ) {
    return "msme_owner";
  }
  if (
    borrowerType.includes("home") ||
    borrowerType.includes("no_income") ||
    borrowerType.includes("homemaker") ||
    occupation.includes("homemaker")
  ) {
    return "homemaker";
  }
  return "low_income_salaried";
}

function getIncomeEstimate(user, borrowerProfile, applicationInput = {}) {
  if (Number(applicationInput?.incomeAnnual) > 0) {
    return Number(applicationInput.incomeAnnual);
  }

  if (Number(user?.incomTotal) > 0) {
    return Number(user.incomTotal);
  }

  const profile = borrowerProfile || {};
  const salariedMonthly = Number(profile?.salaried?.monthlySalary || 0);
  if (salariedMonthly > 0) {
    return salariedMonthly * 12;
  }

  const farmerAnnual = Number(profile?.farmer?.annualIncome || 0);
  if (farmerAnnual > 0) {
    return farmerAnnual;
  }

  const businessAnnual = Number(profile?.smallBusiness?.annualRevenue || 0);
  if (businessAnnual > 0) {
    return businessAnnual * 0.35;
  }

  const studentAllowance = Number(profile?.student?.monthlyAllowance || 0);
  if (studentAllowance > 0) {
    return studentAllowance * 12;
  }

  const noIncomeSavings = Number(profile?.noIncome?.savingsAmount || 0);
  if (noIncomeSavings > 0) {
    return noIncomeSavings;
  }

  return 0;
}

function runPreScreenChecks({
  user,
  borrowerProfile,
  requestedAmount,
  requestedTenure,
  loanType,
  collateral,
  age,
  applicationInput,
}) {
  const flags = [];
  const incomeEstimate = getIncomeEstimate(
    user,
    borrowerProfile,
    applicationInput
  );

  if (requestedAmount > 10000000) {
    flags.push("amount_exceeds_platform_threshold");
  }

  if (requestedTenure > 240) {
    flags.push("tenure_outlier");
  }

  if (age && Number(age) < 18) {
    flags.push("underage_applicant");
  }

  if (!user?.emailVerified) {
    flags.push("identity_unverified");
  }

  if (incomeEstimate > 0) {
    const annualIncome = Math.max(incomeEstimate, 1);
    const loanToIncome = requestedAmount / annualIncome;
    if (loanToIncome > 18) {
      flags.push("loan_to_income_extreme");
    } else if (loanToIncome > 10) {
      flags.push("loan_to_income_high");
    }
  }

  if (loanType === "home" && collateral?.type !== "property") {
    flags.push("home_loan_without_property_collateral");
  }

  if (requestedAmount > 500000 && (!collateral || collateral.type === "none")) {
    flags.push("high_amount_without_collateral");
  }

  const hardRejectFlags = [
    "underage_applicant",
    "amount_exceeds_platform_threshold",
  ];
  const preScreenStatus = flags.some((flag) => hardRejectFlags.includes(flag))
    ? "reject"
    : flags.length > 0
      ? "review"
      : "pass";

  return {
    flags,
    preScreenStatus,
    manualReviewRequired: preScreenStatus !== "pass",
    incomeEstimate,
  };
}

function inferIncomeTypeFromProfile(borrowerProfile) {
  const borrowerType = String(
    borrowerProfile?.borrowerType || ""
  ).toLowerCase();
  if (borrowerType.includes("student")) return "Student";
  if (borrowerType.includes("farmer")) return "Working";
  if (borrowerType.includes("msme") || borrowerType.includes("business"))
    return "Commercial associate";
  if (
    borrowerType.includes("homemaker") ||
    borrowerType.includes("wage") ||
    borrowerType.includes("gig")
  ) {
    return "Working";
  }
  return "Working";
}

function deriveCategoryValidationWarnings({
  borrowerProfile,
  loanType,
  applicationInput = {},
}) {
  if (!borrowerProfile) {
    const hasSubmittedSignals =
      Number(applicationInput?.incomeAnnual) > 0 ||
      Number(applicationInput?.familyMembersCount) > 0 ||
      Number(applicationInput?.childrenCount) >= 0;
    return hasSubmittedSignals ? [] : ["borrower_profile_missing"];
  }

  const borrowerType = String(borrowerProfile.borrowerType || "").toLowerCase();
  const warnings = [];

  if (borrowerType.includes("farmer")) {
    if (
      !borrowerProfile?.farmer?.landArea &&
      !borrowerProfile?.farmer?.annualIncome
    ) {
      warnings.push("farmer_profile_missing_land_or_income");
    }
  }

  if (borrowerType.includes("msme") || borrowerType.includes("business")) {
    if (!borrowerProfile?.smallBusiness?.annualRevenue) {
      warnings.push("business_profile_missing_revenue");
    }
  }

  if (borrowerType.includes("student")) {
    if (!borrowerProfile?.student?.coApplicantIncome) {
      warnings.push("student_profile_missing_coapplicant_income");
    }
  }

  if (borrowerType.includes("salaried")) {
    if (!borrowerProfile?.salaried?.monthlySalary) {
      warnings.push("salaried_profile_missing_monthly_salary");
    }
  }

  if (
    loanType === "business" &&
    !borrowerProfile?.smallBusiness?.businessType
  ) {
    warnings.push("business_loan_missing_business_type");
  }

  return warnings;
}

function transformApplicationToModelFeatures({
  user,
  borrowerProfile,
  loanType,
  requestedAmount,
  requestedTenure,
  collateral,
  age,
  dateOfBirth,
  applicationInput = {},
}) {
  const incomeEstimate = getIncomeEstimate(
    user,
    borrowerProfile,
    applicationInput
  );
  const submittedChildren = toNumberOrNull(applicationInput?.childrenCount);
  const submittedFamily = toNumberOrNull(applicationInput?.familyMembersCount);
  const userCategory = inferUserCategory({
    borrowerProfile,
    applicationInput,
    loanType,
  });
  const totalExistingEmiBurden =
    toNumberOrNull(applicationInput?.existingEmi) ??
    toNumberOrNull(borrowerProfile?.totalExistingEMIBurden) ??
    0;
  const alternativeData = borrowerProfile?.alternativeData || {};
  const monthlyRevenue =
    Number(borrowerProfile?.smallBusiness?.annualRevenue || 0) > 0
      ? Number(borrowerProfile.smallBusiness.annualRevenue) / 12
      : (toNumberOrNull(
        borrowerProfile?.smallBusiness?.monthlyTransactionVolume
      ) ?? 0);
  const monthlyExpenses =
    toNumberOrNull(borrowerProfile?.noIncome?.monthlyExpenses) ??
    (monthlyRevenue > 0 ? monthlyRevenue * 0.72 : 0);
  const monthlySalaryNet =
    toNumberOrNull(borrowerProfile?.salaried?.monthlySalary) ?? 0;
  const studentMonthlyAllowance =
    toNumberOrNull(borrowerProfile?.student?.monthlyAllowance) ?? 0;
  const coApplicantIncome =
    toNumberOrNull(borrowerProfile?.student?.coApplicantIncome) ?? 0;
  const inferredMonthlyIncome = incomeEstimate > 0 ? incomeEstimate / 12 : 0;
  const hasBankAccount = Boolean(
    monthlySalaryNet > 0 ||
    alternativeData?.upiTransactionCount > 0 ||
    alternativeData?.upiTransactionVolume > 0 ||
    borrowerProfile?.smallBusiness?.upiId ||
    user?.flagEmail ||
    user?.emailVerified
  );
  const hasUpiHistory = Boolean(
    alternativeData?.upiTransactionCount > 0 ||
    alternativeData?.upiTransactionVolume > 0 ||
    borrowerProfile?.smallBusiness?.upiId
  );

  return {
    userCategory,
    borrowerType: borrowerProfile?.borrowerType || null,
    requestedAmount: Number(requestedAmount || 0),
    requestedTenureMonths: Number(requestedTenure || 0),
    loanType,
    age: toNumberOrNull(age),
    dateOfBirth: dateOfBirth || null,
    gender:
      String(applicationInput?.gender || "").toUpperCase() ||
      user?.gender ||
      "M",
    occupation: applicationInput?.occupation || null,
    incomeType:
      applicationInput?.incomeType ||
      deriveIncomeTypeFromOccupation(applicationInput?.occupation) ||
      inferIncomeTypeFromProfile(borrowerProfile),
    annualIncomeEstimate: Number(
      applicationInput?.incomeAnnual || user?.incomTotal || incomeEstimate || 0
    ),
    monthlyIncome: inferredMonthlyIncome,
    householdSize: Number(submittedFamily ?? user?.cntFamMembers ?? 1),
    childrenCount: Number(submittedChildren ?? user?.cntChildren ?? 0),
    hasBankAccount,
    hasUpiHistory,
    utilityBillConsistency: toNumberOrNull(
      alternativeData?.utilityBillConsistency
    ),
    upiTransactionCount: toNumberOrNull(alternativeData?.upiTransactionCount),
    upiTransactionVolume: toNumberOrNull(alternativeData?.upiTransactionVolume),
    ecommerceSalesVolume: toNumberOrNull(alternativeData?.ecommerceSalesVolume),
    transactionHistoryUploaded: Boolean(
      alternativeData?.transactionHistoryPath
    ),
    monthlySalaryNet,
    employmentTenureMonths:
      Number(borrowerProfile?.salaried?.yearsEmployed || 0) * 12,
    employerType: borrowerProfile?.salaried?.employmentType || null,
    salaryCreditedToBank: hasBankAccount,
    landSize: toNumberOrNull(borrowerProfile?.farmer?.landArea),
    cropType: borrowerProfile?.farmer?.cropTypes?.[0] || null,
    hasKcc: Boolean(borrowerProfile?.farmer?.kisanCardNumber),
    farmerAnnualIncome: toNumberOrNull(borrowerProfile?.farmer?.annualIncome),
    monthlyRevenue,
    monthlyExpenses,
    businessAgeMonths:
      Number(borrowerProfile?.smallBusiness?.yearsInOperation || 0) * 12,
    hasGst: Boolean(borrowerProfile?.smallBusiness?.gstNumber),
    hasUdyam: false,
    isFormalized: Boolean(borrowerProfile?.smallBusiness?.gstNumber),
    monthlyTransactionVolume: toNumberOrNull(
      borrowerProfile?.smallBusiness?.monthlyTransactionVolume
    ),
    upiId: borrowerProfile?.smallBusiness?.upiId || null,
    monthlyAllowance: studentMonthlyAllowance,
    coApplicantIncome,
    householdMonthlyIncome:
      inferredMonthlyIncome ||
      coApplicantIncome / 12 ||
      studentMonthlyAllowance,
    savingsAmount: toNumberOrNull(borrowerProfile?.noIncome?.savingsAmount),
    totalExistingEmiBurden,
    docsVerified: Boolean(
      user?.emailVerified ||
      hasBankAccount ||
      alternativeData?.transactionHistoryPath ||
      applicationInput?.identityVerified   // OCR Textract result (additive)
    ),
    collateralType: collateral?.type || "none",
    collateralValue: Number(collateral?.estimatedValue || 0),
  };
}

function policyBandFromRisk(riskLevel) {
  if (riskLevel === "low") {
    return { multiplier: 1.0, interest: 10.5, maxIncomeMultiple: 24 };
  }
  if (riskLevel === "medium") {
    return { multiplier: 0.8, interest: 13.5, maxIncomeMultiple: 18 };
  }
  return { multiplier: 0.55, interest: 18.5, maxIncomeMultiple: 12 };
}

function buildDecisionFromLayers({
  mlResult,
  preScreen,
  requestedAmount,
  requestedTenure,
  collateral,
}) {
  const riskLevel = normalizeRiskLevel(mlResult?.riskLevel);
  const policy = policyBandFromRisk(riskLevel);
  // mlResult.probability is P(good/repayment) from the model (high = creditworthy);
  // invert to get P(default) used in decision thresholds.
  const probabilityOfDefault = 1 - Number(mlResult?.probability ?? 0.5);

  let eligibleAmount = Number((requestedAmount * policy.multiplier).toFixed(2));
  const annualIncome = Number(preScreen.incomeEstimate || 0);
  if (annualIncome > 0) {
    const incomeBound = annualIncome * policy.maxIncomeMultiple;
    eligibleAmount = Math.min(eligibleAmount, incomeBound);
  }
  eligibleAmount = Math.max(0, eligibleAmount);

  let decision = "Hold";
  let status = "under_review";

  if (preScreen.preScreenStatus === "reject") {
    decision = "Reject";
    status = "auto_rejected";
  } else if (
    preScreen.preScreenStatus === "pass" &&
    riskLevel === "low" &&
    probabilityOfDefault <= 0.18 &&
    requestedAmount <= 300000
  ) {
    decision = "Approve";
    status = "auto_approved";
  } else if (riskLevel === "high" && probabilityOfDefault >= 0.55) {
    decision = "Reject";
    status = "auto_rejected";
  }

  // Bounded trust adjustment using collateral as a trust proxy for borderline cases.
  const collateralValue = Number(collateral?.estimatedValue || 0);
  if (
    decision !== "Approve" &&
    collateralValue >= requestedAmount * 1.5 &&
    preScreen.preScreenStatus !== "reject"
  ) {
    decision = decision === "Reject" ? "Hold" : "Approve";
    status = decision === "Approve" ? "auto_approved" : "under_review";
  }

  const interest = policy.interest;
  const reasonParts = [
    `Model risk=${riskLevel}`,
    `PD=${probabilityOfDefault.toFixed(3)}`,
    `Pre-screen=${preScreen.preScreenStatus}`,
  ];
  if (preScreen.flags.length) {
    reasonParts.push(`Flags=${preScreen.flags.join(",")}`);
  }

  return {
    riskLevel,
    creditScore: Number(mlResult?.creditScore || 600),
    probabilityOfDefault,
    eligibleAmount,
    suggestedInterestRate: interest,
    suggestedTenure: requestedTenure,
    decision,
    status,
    decisionReason: reasonParts.join(" | "),
  };
}

// ==================== APPLY FOR LOAN ====================
export const applyForLoan = async (req, res) => {
  try {
    console.log("\n📥 LOAN APPLICATION RECEIVED");
    console.log(" Request body:", JSON.stringify(req.body, null, 2));
    const userId = req.user?._id;
    console.log("👤 User ID from auth:", userId);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized - No user ID" });
    }

    const {
      loanType,
      requestedAmount,
      requestedTenure,
      purpose,
      collateral,
      dateOfBirth,
      age,
      applicantProfile,
      educationDetails,
      homeDetails,
      autoDetails,
      businessDetails,
      identityVerified,   // OCR Textract result (additive)
      applicantType: submittedApplicantType,
      alternateData,
      alternateDataConsent,
      alternateReferenceId,
      alternateReferenceIdType,
      alternateUserSignals,
    } = req.body;

    const applicantType = normalizeApplicantType(submittedApplicantType);

    // Validate required fields
    if (!loanType || !requestedAmount || !requestedTenure) {
      return res.status(400).json({
        message:
          "Missing required fields: loanType, requestedAmount, requestedTenure",
      });
    }

    if (applicantType === "unbanked" && !alternateDataConsent) {
      return res.status(400).json({
        message: "Alternate data consent is required for unbanked assessment",
      });
    }
    if (applicantType === "unbanked") {
      const refNorm = String(alternateReferenceId || "").trim();
      if (refNorm.length < 4) {
        return res.status(400).json({
          message:
            "alternateReferenceId is required for unbanked applications (e.g. PAN or masked bank reference, min 4 characters)",
        });
      }
      const alternateValidationErrors = validateAlternateDataPayload(
        alternateData || {},
        { referenceId: refNorm }
      );
      if (alternateValidationErrors.length) {
        return res.status(400).json({
          message: "Invalid alternate underwriting payload",
          validationWarnings: alternateValidationErrors,
        });
      }
    }

    // Validate loan type
    const validTypes = [
      "personal",
      "home",
      "auto",
      "education",
      "business",
      "credit_card",
    ];
    if (!validTypes.includes(loanType)) {
      return res
        .status(400)
        .json({ message: `Invalid loan type: ${loanType}` });
    }

    console.log(` Validated user: ${userId}`);
    console.log(` Validated loan type: ${loanType}`);

    // Pull user and optional borrower profile for layered scoring.
    const [user, borrowerProfile] = await Promise.all([
      User.findById(userId),
      BorrowerProfile.findOne({ userId }),
    ]);

    const normalizedAmount = Number(requestedAmount);
    const normalizedTenure = Number(requestedTenure);

    const safeCollateral = collateral || { type: "none" };
    const educationFallbackOccupation =
      loanType === "education" ? "Student" : null;
    const normalizedEducationDetails =
      loanType === "education"
        ? {
          courseName:
            String(educationDetails?.courseName || "").trim() || null,
          university:
            String(educationDetails?.university || "").trim() || null,
          studyLocation:
            String(educationDetails?.studyLocation || "").trim() || null,
          courseDurationYears: toNumberOrNull(
            educationDetails?.courseDurationYears
          ),
        }
        : null;

    const normalizedApplicantProfile = {
      incomeAnnual: toNumberOrNull(applicantProfile?.incomeAnnual),
      familyMembersCount: toNumberOrNull(applicantProfile?.familyMembersCount),
      childrenCount: toNumberOrNull(applicantProfile?.childrenCount),
      gender: applicantProfile?.gender,
      occupation: applicantProfile?.occupation || educationFallbackOccupation,
      incomeType:
        applicantProfile?.incomeType ||
        (loanType === "education" ? "Student" : null),
      maritalStatus: applicantProfile?.maritalStatus,
      hasExistingLoan: applicantProfile?.hasExistingLoan,
      existingEmi: toNumberOrNull(applicantProfile?.existingEmi),
      identityVerified: Boolean(identityVerified),  // OCR Textract result
    };

    const preScreen = runPreScreenChecks({
      user,
      borrowerProfile,
      requestedAmount: normalizedAmount,
      requestedTenure: normalizedTenure,
      loanType,
      collateral: safeCollateral,
      age,
      applicationInput: normalizedApplicantProfile,
    });

    const categoryWarnings = deriveCategoryValidationWarnings({
      borrowerProfile,
      loanType,
      applicationInput: normalizedApplicantProfile,
    });
    if (categoryWarnings.length) {
      preScreen.flags.push(...categoryWarnings);
      if (preScreen.preScreenStatus === "pass") {
        preScreen.preScreenStatus = "review";
      }
      preScreen.manualReviewRequired = true;
    }

    let modelFeatures = transformApplicationToModelFeatures({
      user,
      borrowerProfile,
      loanType,
      requestedAmount: normalizedAmount,
      requestedTenure: normalizedTenure,
      collateral: safeCollateral,
      age,
      dateOfBirth,
      applicationInput: normalizedApplicantProfile,
    });

    let mlResult;
    let scoringSource = "ml_model";
    let decision;
    let alternateUnderwriting = null;
    let unbankedSavedMeta = null;

    if (applicantType === "unbanked") {
      const refKey = String(alternateReferenceId || "").trim().toUpperCase();
      const idTypeRaw = String(alternateReferenceIdType || "pan").toLowerCase();
      const idType = ["pan", "bank_account_masked", "other"].includes(idTypeRaw)
        ? idTypeRaw
        : "pan";
      const pipe = await runUnbankedScoringPipeline({
        alternateData: {
          ...(alternateData || {}),
          userSuppliedCsv: Boolean((alternateData || {}).userSuppliedCsv),
        },
        adminAttached: null,
        requestedAmount: normalizedAmount,
        requestedTenure: normalizedTenure,
        alternateUserSignals: alternateUserSignals || {},
        consentAcknowledged: Boolean(alternateDataConsent),
      });
      alternateUnderwriting = pipe.alternateUnderwritingDoc;
      modelFeatures = { ...modelFeatures, ...pipe.modelFeaturesPatch };
      scoringSource = pipe.scoringSource;
      decision = pipe.decision;
      preScreen.flags.push(...pipe.preScreenWarnings);
      unbankedSavedMeta = {
        refKey,
        idType,
        alternateUserSignals: alternateUserSignals || {},
      };
    } else {
      try {
        mlResult = await predictCreditScoreWithModel(modelFeatures);
        if (
          String(mlResult?.modelInfo?.modelType || "").includes(
            "GuardrailHeuristic"
          )
        ) {
          scoringSource = "guardrail_fallback";
        }
      } catch (mlError) {
        scoringSource = "legacy_fallback";
        const fallbackRisk =
          preScreen.preScreenStatus === "reject"
            ? "high"
            : preScreen.preScreenStatus === "review"
              ? "medium"
              : "low";
        mlResult = {
          creditScore:
            fallbackRisk === "low" ? 720 : fallbackRisk === "medium" ? 610 : 480,
          riskLevel: fallbackRisk,
          // NOTE: this value is repayment probability (not PD). PD is derived as 1 - probability.
          probability:
            fallbackRisk === "low"
              ? 0.82
              : fallbackRisk === "medium"
                ? 0.65
                : 0.22,
          modelInfo: {
            modelType: "LegacyFallback",
            nFeaturesUsed: Object.keys(modelFeatures).length,
            artifactPath: null,
          },
        };
        preScreen.flags.push(summarizeMlError(mlError));
      }

      decision = buildDecisionFromLayers({
        mlResult,
        preScreen,
        requestedAmount: normalizedAmount,
        requestedTenure: normalizedTenure,
        collateral: safeCollateral,
      });
    }

    // Create loan application
    const loanData = {
      userId,
      loanType,
      requestedAmount: normalizedAmount,
      requestedTenure: normalizedTenure,
      purpose: purpose || normalizedEducationDetails?.courseName || "General",
      collateral: safeCollateral,
      status: decision.status,
      applicantType,
      submittedAt: new Date(),
    };

    // Generate a human-readable loan code like P1, H2, etc.
    try {
      loanData.loanCode = await generateLoanCode(loanType);
    } catch (codeError) {
      console.warn("⚠ Failed to generate loanCode, continuing without it:", codeError.message);
    }

    // Add loan-specific details
    if (loanType === "home" && homeDetails) {
      loanData.homeDetails = {
        area: toNumberOrNull(homeDetails.area),
        bhk: homeDetails.bhk || null,
        location: homeDetails.location || null,
        propertyType: homeDetails.propertyType || null,
      };
    }

    if (loanType === "auto" && autoDetails) {
      loanData.autoDetails = {
        vehicleType: autoDetails.vehicleType || null,
        model: autoDetails.model || null,
        registrationNumber: autoDetails.registrationNumber || null,
        estimatedValue: toNumberOrNull(autoDetails.estimatedValue),
      };
    }

    if (loanType === "business" && businessDetails) {
      loanData.businessDetails = {
        businessType: businessDetails.businessType || null,
        businessName: businessDetails.businessName || null,
        yearsInOperation: toNumberOrNull(businessDetails.yearsInOperation),
        annualTurnover: toNumberOrNull(businessDetails.annualTurnover),
      };
    }

    if (dateOfBirth) loanData.dateOfBirth = dateOfBirth;
    if (age) loanData.age = Number(age);

    if (applicantType === "unbanked" && unbankedSavedMeta) {
      loanData.alternateReferenceId = unbankedSavedMeta.refKey;
      loanData.alternateReferenceIdType = unbankedSavedMeta.idType;
      loanData.alternateUserSignals = {
        hasUpiHint: Boolean(unbankedSavedMeta.alternateUserSignals?.hasUpiHint),
        hasUtilityHint: Boolean(
          unbankedSavedMeta.alternateUserSignals?.hasUtilityHint
        ),
      };
    }

    // Layered AI + policy decision (non-breaking keys preserved for frontend).
    loanData.aiAnalysis = {
      creditScore: decision.creditScore,
      riskLevel: decision.riskLevel,
      eligibleAmount: decision.eligibleAmount,
      suggestedInterestRate: decision.suggestedInterestRate,
      suggestedTenure: decision.suggestedTenure,
      amlFlags: preScreen.flags,
      shapFactors: {
        explanationSummary: (() => {
          const base = [
            decision.decisionReason,
            `scoringSource=${scoringSource}`,
            `borrowerType=${borrowerProfile?.borrowerType || modelFeatures?.userCategory || "unknown"}`,
          ];
          if (
            applicantType === "unbanked" &&
            alternateUnderwriting?.explanationMetadata?.shap?.topFeatures?.length
          ) {
            base.push("alternate_model_shap_top:");
            alternateUnderwriting.explanationMetadata.shap.topFeatures
              .slice(0, 8)
              .forEach((t) => {
                base.push(`  ${t.name} (shap=${t.shapValue})`);
              });
          }
          return base;
        })(),
      },
      modelVersion: "winner_upgrade_v5",
    };

    loanData.features = {
      modelFeatures,
      applicantProfile: normalizedApplicantProfile,
      educationDetails: normalizedEducationDetails,
      scoringSource,
      probabilityOfDefault: decision.probabilityOfDefault,
      preScreenStatus: preScreen.preScreenStatus,
      manualReviewRequired: preScreen.manualReviewRequired,
      decision: decision.decision,
      decisionReason: decision.decisionReason,
      borrowerType: borrowerProfile?.borrowerType || null,
      underwritingPath: applicantType,
      alternateWarnings: alternateUnderwriting?.warnings || [],
      alternateConfidence: alternateUnderwriting?.confidenceLevel || null,
      alternateReliabilityFlag: alternateUnderwriting?.reliabilityFlag || null,
      userDecisionExplanation: buildUserDecisionExplanation({
        decision,
        applicantType,
        preScreen,
        alternateUnderwriting,
      }),
    };

    if (alternateUnderwriting) {
      loanData.alternateUnderwriting = {
        ...alternateUnderwriting,
        explanationMetadata: {
          ...(alternateUnderwriting.explanationMetadata || {}),
          preScreenStatus: preScreen.preScreenStatus,
        },
      };
    }

    const loan = new LoanApplication(loanData);
    console.log("📝 Loan object created, attempting to save...");
    console.log(
      "💾 Loan data to save:",
      JSON.stringify(
        {
          userId,
          loanType,
          requestedAmount,
          requestedTenure,
          status: loanData.status,
          collateral: loanData.collateral,
        },
        null,
        2
      )
    );

    const savedLoan = await loan.save();

    // Keep user dashboard score in sync with latest model-backed decision.
    try {
      await User.findByIdAndUpdate(userId, {
        creditScore: decision.creditScore,
      });
    } catch (syncError) {
      console.warn(
        "⚠ Could not sync user creditScore from latest loan:",
        syncError.message
      );
    }

    console.log(
      ` LOAN SAVED: ${savedLoan._id} - Status: ${savedLoan.status}`
    );

    // Send submission confirmation email
    if (user && user.email) {
      try {
        await sendLoanSubmittedEmail(user.email, user.fullName, {
          loanId: savedLoan._id,
          loanType: savedLoan.loanType,
          requestedAmount: savedLoan.requestedAmount,
          requestedTenure: savedLoan.requestedTenure,
          submittedAt: savedLoan.submittedAt,
          status: savedLoan.status,
        });
        console.log(
          ` Loan submission confirmation email sent to: ${user.email}`
        );
      } catch (emailError) {
        console.error(
          "Failed to send loan submission email:",
          emailError.message
        );
        // Continue - email failure doesn't block the loan submission
      }
    }

    return res.status(201).json({
      message: "Loan application submitted successfully",
      data: {
        loanId: savedLoan._id,
        loan: savedLoan,
        status: savedLoan.status,
      },
      decisionOutput: {
        applicant_type: applicantType,
        underwriting_path:
          applicantType === "unbanked" ? "alternate" : "banked_model",
        normalized_features_summary:
          alternateUnderwriting?.normalizedFeaturesSummary || null,
        credit_score: decision.creditScore,
        probability_of_default: decision.probabilityOfDefault,
        risk_band: decision.riskLevel,
        recommended_loan_amount: decision.eligibleAmount,
        interest_range: `${Math.max(8, decision.suggestedInterestRate - 2)}%-${decision.suggestedInterestRate + 2}%`,
        decision: decision.decision,
        decision_reason: decision.decisionReason,
        flags: preScreen.flags,
        confidence: alternateUnderwriting?.confidenceLevel || "high",
        reliability_flag: alternateUnderwriting?.reliabilityFlag || "sufficient_data",
        missing_inputs: alternateUnderwriting?.warnings || [],
        explanation: alternateUnderwriting
          ? {
            reasons: alternateUnderwriting.reasons,
            warnings: alternateUnderwriting.warnings,
            trust_score: alternateUnderwriting.trustScore,
            fraud_risk_score: alternateUnderwriting.fraudRiskScore,
          }
          : null,
      },
    });
  } catch (error) {
    console.error("ERROR APPLYING LOAN:", error.message);
    console.error("Full Error:", error);
    if (error.errors) {
      console.error(
        "Validation Errors:",
        Object.keys(error.errors).map((k) => `${k}: ${error.errors[k].message}`)
      );
    }
    return res.status(500).json({
      message: "Error submitting loan application",
      error: error.message,
      details: error.errors
        ? Object.keys(error.errors).map(
          (k) => `${k}: ${error.errors[k].message}`
        )
        : undefined,
    });
  }
};

// ==================== GET MY LOANS ====================
export const getMyLoans = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    console.log(`📥 Fetching loans for user: ${userId}`);

    const loans = await LoanApplication.find({ userId }).sort({
      submittedAt: -1,
    });

    const normalizedLoans = loans.map((loanDoc) => {
      const loan = loanDoc.toObject({ virtuals: true });
      loan.displayStatus = getLoanDisplayStatus(loan.status);
      return loan;
    });

    console.log(` Found ${normalizedLoans.length} loans`);

    return res.status(200).json({
      message: "Loans fetched successfully",
      data: { loans: normalizedLoans },
      loans: normalizedLoans,
    });
  } catch (error) {
    console.error("ERROR FETCHING LOANS:", error.message);
    return res.status(500).json({
      message: "Error fetching loans",
      error: error.message,
    });
  }
};

// ==================== GET LOAN BY ID ====================
export const getMyLoanById = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { loanId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    console.log(`\n📋 GET LOAN BY ID`);
    console.log(`   Loan ID: ${loanId}`);
    console.log(`   User ID: ${userId}`);

    const loanDoc = await LoanApplication.findOne({ _id: loanId, userId })
      .populate("userId", "fullName email phone creditScore")
      .populate("assignedAdminId", "fullName email")
      .populate("adminDecision.adminId", "fullName email");

    if (!loanDoc) {
      console.log(`Loan not found or doesn't belong to this user`);
      return res.status(404).json({ message: "Loan not found" });
    }

    const loan = loanDoc.toObject({ virtuals: true });
    loan.displayStatus = getLoanDisplayStatus(loan.status);

    console.log(` Loan found`);
    console.log(`   Status: ${loan.status}`);
    console.log(`   Amount: ₹${loan.requestedAmount}`);
    console.log(`   User: ${loan.userId?.fullName}`);

    return res.status(200).json({
      message: "Loan fetched successfully",
      loan,
    });
  } catch (error) {
    console.error("ERROR FETCHING LOAN:", error.message);
    return res.status(500).json({
      message: "Error fetching loan",
      error: error.message,
    });
  }
};

// ==================== ACCEPT LOAN ====================
export const acceptLoanOffer = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { loanId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const loan = await LoanApplication.findOne({ _id: loanId, userId });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (!["auto_approved", "approved"].includes(loan.status)) {
      return res
        .status(400)
        .json({ message: "Loan cannot be accepted in its current status" });
    }

    loan.status = "accepted";
    const updatedLoan = await loan.save();

    console.log(` Loan ${loanId} accepted`);

    return res.status(200).json({
      message: "Loan accepted",
      loan: updatedLoan,
    });
  } catch (error) {
    console.error("ERROR ACCEPTING LOAN:", error.message);
    return res.status(500).json({
      message: "Error accepting loan",
      error: error.message,
    });
  }
};

// ==================== DECLINE LOAN ====================
export const declineLoanOffer = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { loanId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const loan = await LoanApplication.findOne({ _id: loanId, userId });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (!["auto_approved", "approved"].includes(loan.status)) {
      return res
        .status(400)
        .json({ message: "Loan cannot be declined in its current status" });
    }

    loan.status = "declined";
    const updatedLoan = await loan.save();

    console.log(` Loan ${loanId} declined`);

    return res.status(200).json({
      message: "Loan declined",
      loan: updatedLoan,
    });
  } catch (error) {
    console.error("ERROR DECLINING LOAN:", error.message);
    return res.status(500).json({
      message: "Error declining loan",
      error: error.message,
    });
  }
};
