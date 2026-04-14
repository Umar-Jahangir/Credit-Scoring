import LoanApplication from "../models/LoanApplication.js";
import User from "../models/User.js";
import {
  sendLoanApprovedEmail,
  sendLoanRejectedEmail,
} from "../services/emailService.js";
import {
  lookupAlternateVault,
  normalizeReferenceId,
  listAlternateVaultKeys,
} from "../data/alternateDataVault.js";
import {
  runUnbankedScoringPipeline,
  applyUnbankedPipelineResultToLoan,
} from "../services/alternateScoringPipeline.js";
import {
  parseCsv,
  buildUpiSummary,
  buildUtilitySummary,
} from "../utils/alternateCsvSummaries.js";
import {
  probabilityOfDefaultFromBlendedScore,
  riskLevelFromBlendedScore,
} from "../utils/alternateDisplayAlignment.js";

const VALID_RISK_LEVELS = ["low", "medium", "high"];
const VALID_PRE_SCREEN = ["pass", "review", "reject"];
const VALID_LOAN_TYPES = [
  "personal",
  "home",
  "auto",
  "education",
  "business",
  "credit_card",
];

const parseCsvParam = (value) => {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeDecision = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "approve") return "Approve";
  if (normalized === "reject") return "Reject";
  if (normalized === "hold") return "Hold";
  return null;
};

const applyAdminLoanFilters = (query, reqQuery) => {
  const nextQuery = { ...query };

  const requestedLoanTypes = parseCsvParam(reqQuery.loanType).filter((value) =>
    VALID_LOAN_TYPES.includes(value)
  );
  if (requestedLoanTypes.length > 0) {
    nextQuery.loanType = { $in: requestedLoanTypes };
  }

  const statuses = parseCsvParam(reqQuery.status);
  if (statuses.length > 0) {
    nextQuery.status = { $in: statuses };
  }

  const riskLevels = parseCsvParam(reqQuery.risk).filter((value) =>
    VALID_RISK_LEVELS.includes(value)
  );
  if (riskLevels.length > 0) {
    nextQuery["aiAnalysis.riskLevel"] = { $in: riskLevels };
  }

  const preScreenStatuses = parseCsvParam(reqQuery.preScreenStatus).filter(
    (value) => VALID_PRE_SCREEN.includes(value)
  );
  if (preScreenStatuses.length > 0) {
    nextQuery["features.preScreenStatus"] = { $in: preScreenStatuses };
  }

  const decisions = parseCsvParam(reqQuery.decision)
    .map(normalizeDecision)
    .filter(Boolean);
  if (decisions.length > 0) {
    nextQuery["features.decision"] = { $in: decisions };
  }

  return nextQuery;
};

const mapStatusToDecision = (status) => {
  if (["auto_approved", "approved", "accepted", "disbursed"].includes(status))
    return "Approve";
  if (["auto_rejected", "rejected", "declined"].includes(status))
    return "Reject";
  return "Hold";
};

const FINAL_STATUS_ALLOWLIST = new Set([
  "auto_approved",
  "approved",
  "accepted",
  "declined",
  "disbursed",
  "closed",
  "auto_rejected",
  "rejected",
]);

const IN_REVIEW_STATUS_ALLOWLIST = new Set([
  "pending",
  "under_review",
  "review",
  "hold",
  "processing",
]);

const deriveEffectiveStatus = (loan = {}) => {
  const rawStatus = String(loan?.status || "").toLowerCase();

  if (FINAL_STATUS_ALLOWLIST.has(rawStatus)) {
    return rawStatus;
  }

  const decision = String(loan?.features?.decision || "").toLowerCase();
  const preScreenStatus = String(loan?.features?.preScreenStatus || "").toLowerCase();
  const alternateDecision = String(
    loan?.alternateUnderwriting?.decision || ""
  ).toLowerCase();

  const inferredReject =
    decision === "reject" ||
    preScreenStatus === "reject" ||
    alternateDecision === "reject";
  const inferredApprove =
    decision === "approve" || alternateDecision === "approve";

  if (inferredReject) {
    return "auto_rejected";
  }
  if (inferredApprove) {
    return "auto_approved";
  }

  if (IN_REVIEW_STATUS_ALLOWLIST.has(rawStatus)) {
    return "under_review";
  }

  return "under_review";
};

const attachDecisionSummary = (loanDoc) => {
  const loan = loanDoc?.toObject ? loanDoc.toObject() : loanDoc;
  const features = loan?.features || {};
  const aiAnalysis = loan?.aiAnalysis || {};
  const effectiveStatus = deriveEffectiveStatus(loan);

  return {
    ...loan,
    effectiveStatus,
    decisionSummary: {
      decision: features.decision || mapStatusToDecision(effectiveStatus),
      decisionReason: features.decisionReason || null,
      preScreenStatus: features.preScreenStatus || null,
      manualReviewRequired: Boolean(features.manualReviewRequired),
      probabilityOfDefault: features.probabilityOfDefault ?? null,
      flags: aiAnalysis.amlFlags || [],
      scoringSource: features.scoringSource || null,
    },
  };
};

export const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  next();
};

// Get loans filtered by admin's loan type
export const getPendingLoans = async (req, res) => {
  try {
    const admin = await User.findById(req.user._id);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    // Filter loans by admin's loan type
    let query = { status: "under_review" };
    if (admin.adminLoanType) {
      query.loanType = admin.adminLoanType;
    }

    query = applyAdminLoanFilters(query, req.query);

    const loans = await LoanApplication.find(query)
      .populate("userId", "fullName phone email creditScore")
      .sort({ submittedAt: -1 });

    return res.status(200).json({
      loans: loans.map(attachDecisionSummary),
      adminLoanType: admin.adminLoanType,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching pending loans",
      error: error.message,
    });
  }
};

// Get admin dashboard data (filtered by loan type)
export const getAdminDashboard = async (req, res) => {
  try {
    const admin = await User.findById(req.user._id);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    let query = {};
    if (admin.adminLoanType) {
      query.loanType = admin.adminLoanType;
    }

    query = applyAdminLoanFilters(query, req.query);

    // Get all loans for this admin's loan type
    const totalApplications = await LoanApplication.countDocuments(query);
    const approvedLoans = await LoanApplication.countDocuments({
      ...query,
      status: { $in: ["approved", "accepted", "disbursed"] },
    });
    const rejectedLoans = await LoanApplication.countDocuments({
      ...query,
      status: "rejected",
    });
    const autoRejectedLoans = await LoanApplication.countDocuments({
      ...query,
      status: "auto_rejected",
    });
    const pendingLoans = await LoanApplication.countDocuments({
      ...query,
      status: "under_review",
    });

    // Calculate total disbursed amount - sum approved amounts for approved/accepted/disbursed loans
    const disbursedData = await LoanApplication.aggregate([
      {
        $match: {
          ...query,
          status: { $in: ["approved", "accepted", "disbursed"] },
          "adminDecision.approvedAmount": { $exists: true, $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalDisbursed: { $sum: "$adminDecision.approvedAmount" },
        },
      },
    ]);

    const totalDisbursed = disbursedData[0]?.totalDisbursed || 0;

    // Get active loans count (approved, accepted or disbursed - loans that have been processed and approved)
    const activeLoans = await LoanApplication.countDocuments({
      ...query,
      status: { $in: ["approved", "accepted", "disbursed"] },
    });

    // Get recent applications
    const recentApplications = await LoanApplication.find(query)
      .populate("userId", "fullName phone email creditScore")
      .sort({ submittedAt: -1 })
      .limit(10);

    const riskBuckets = await LoanApplication.aggregate([
      { $match: query },
      {
        $group: {
          _id: { $ifNull: ["$aiAnalysis.riskLevel", "unknown"] },
          count: { $sum: 1 },
        },
      },
    ]);

    const riskDistribution = riskBuckets.reduce(
      (acc, item) => ({ ...acc, [item._id]: item.count }),
      { low: 0, medium: 0, high: 0, unknown: 0 }
    );

    return res.status(200).json({
      adminLoanType: admin.adminLoanType || "all",
      metrics: {
        totalApplications,
        approvedLoans,
        rejectedLoans,
        autoRejectedLoans,
        pendingLoans,
        totalDisbursed,
        activeLoans,
        riskDistribution,
      },
      recentApplications: recentApplications.map(attachDecisionSummary),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching admin dashboard",
      error: error.message,
    });
  }
};

export const approveByAdmin = async (req, res) => {
  try {
    const { loanId } = req.params;
    const { approvedAmount, interestRate, tenure, notes } = req.body;

    const loan = await LoanApplication.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    // Verify admin is authorized for this loan type
    const admin = await User.findById(req.user._id);
    if (admin.adminLoanType && admin.adminLoanType !== loan.loanType) {
      return res
        .status(403)
        .json({ message: "Not authorized to handle this loan type" });
    }

    loan.adminDecision = {
      ...(loan.adminDecision || {}),
      approvedAmount,
      interestRate,
      tenure,
      notes,
      adminId: req.user._id,
      decidedAt: new Date(),
    };
    loan.status = "approved";
    loan.assignedAdminId = req.user._id;
    loan.assignedAt = new Date();

    const updatedLoan = await loan.save();

    // Populate user details before returning
    const populatedLoan = await LoanApplication.findById(updatedLoan._id)
      .populate("userId", "fullName phone email creditScore")
      .populate("assignedAdminId", "fullName email");

    // Send approval email to user
    if (populatedLoan.userId && populatedLoan.userId.email) {
      try {
        await sendLoanApprovedEmail(
          populatedLoan.userId.email,
          populatedLoan.userId.fullName,
          {
            loanId: populatedLoan._id,
            loanType: populatedLoan.loanType,
            requestedAmount: populatedLoan.requestedAmount,
            approvedAmount,
            interestRate,
            tenure,
            notes,
          }
        );
        console.log(
          `Loan approval email sent to: ${populatedLoan.userId.email}`
        );
      } catch (emailError) {
        console.error(
          "Failed to send loan approval email:",
          emailError.message
        );
        // Continue - email failure doesn't block the approval
      }
    }

    return res.status(200).json({
      loan: attachDecisionSummary(populatedLoan),
      message: "Loan approved successfully",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error approving loan",
      error: error.message,
    });
  }
};

export const rejectByAdmin = async (req, res) => {
  try {
    const { loanId } = req.params;
    const { rejectionReason } = req.body;

    const loan = await LoanApplication.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    // Verify admin is authorized for this loan type
    const admin = await User.findById(req.user._id);
    if (admin.adminLoanType && admin.adminLoanType !== loan.loanType) {
      return res
        .status(403)
        .json({ message: "Not authorized to handle this loan type" });
    }

    loan.adminDecision = {
      ...(loan.adminDecision || {}),
      rejectionReason,
      adminId: req.user._id,
      decidedAt: new Date(),
    };
    loan.status = "rejected";
    loan.assignedAdminId = req.user._id;
    loan.assignedAt = new Date();

    const updatedLoan = await loan.save();

    // Populate user details before returning
    const populatedLoan = await LoanApplication.findById(updatedLoan._id)
      .populate("userId", "fullName phone email creditScore")
      .populate("assignedAdminId", "fullName email");

    // Send rejection email to user
    if (populatedLoan.userId && populatedLoan.userId.email) {
      try {
        await sendLoanRejectedEmail(
          populatedLoan.userId.email,
          populatedLoan.userId.fullName,
          {
            loanId: populatedLoan._id,
            loanType: populatedLoan.loanType,
            requestedAmount: populatedLoan.requestedAmount,
            rejectionReason:
              rejectionReason ||
              "Your application did not meet our criteria at this time.",
          }
        );
        console.log(
          `Loan rejection email sent to: ${populatedLoan.userId.email}`
        );
      } catch (emailError) {
        console.error(
          "Failed to send loan rejection email:",
          emailError.message
        );
        // Continue - email failure doesn't block the rejection
      }
    }

    return res.status(200).json({
      loan: attachDecisionSummary(populatedLoan),
      message:
        "Loan rejected. Referred to PMJDY/MUDRA scheme for government assistance",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error rejecting loan",
      error: error.message,
    });
  }
};

// Get all loans assigned to this admin (not just pending)
export const getMyLoans = async (req, res) => {
  try {
    console.log("getMyLoans called for admin");
    const admin = await User.findById(req.user._id);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    console.log(
      `Fetching loans for admin: ${admin.fullName} (type: ${admin.adminLoanType})`
    );

    let query = {};
    if (admin.adminLoanType) {
      query.loanType = admin.adminLoanType;
    }

    query = applyAdminLoanFilters(query, req.query);

    const loans = await LoanApplication.find(query)
      .populate("userId", "fullName phone email creditScore")
      .populate("assignedAdminId", "fullName email")
      .sort({ submittedAt: -1 });

    console.log(`Found ${loans.length} loans for admin`);

    return res.status(200).json({
      loans: loans.map(attachDecisionSummary),
      adminLoanType: admin.adminLoanType || "all",
      message: "Loans fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching admin loans:", error.message);
    return res.status(500).json({
      message: "Error fetching loans",
      error: error.message,
    });
  }
};

export const getLoanByIdForAdmin = async (req, res) => {
  try {
    const { loanId } = req.params;
    const admin = await User.findById(req.user._id);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    const loan = await LoanApplication.findById(loanId)
      .populate("userId", "fullName phone email creditScore")
      .populate("assignedAdminId", "fullName email")
      .populate("adminDecision.adminId", "fullName email");

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (admin.adminLoanType && loan.loanType !== admin.adminLoanType) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this loan type" });
    }

    return res.status(200).json({
      loan: attachDecisionSummary(loan),
      message: "Loan fetched successfully",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching loan",
      error: error.message,
    });
  }
};

export const getLoanExplainabilityForAdmin = async (req, res) => {
  try {
    const { loanId } = req.params;
    const admin = await User.findById(req.user._id);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    const loan = await LoanApplication.findById(loanId)
      .populate("userId", "fullName email phone creditScore")
      .populate("adminDecision.adminId", "fullName email");

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (admin.adminLoanType && loan.loanType !== admin.adminLoanType) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this loan type" });
    }

    const decisionSummary = attachDecisionSummary(loan).decisionSummary;

    let explainPd = loan.features?.probabilityOfDefault ?? null;
    let explainRisk = loan.aiAnalysis?.riskLevel || null;
    if (loan.applicantType === "unbanked" && loan.aiAnalysis?.creditScore != null) {
      const cs = Number(loan.aiAnalysis.creditScore);
      if (Number.isFinite(cs)) {
        explainPd = probabilityOfDefaultFromBlendedScore(cs);
        explainRisk = riskLevelFromBlendedScore(cs);
      }
    }

    return res.status(200).json({
      loanId: loan._id,
      loanType: loan.loanType,
      status: loan.status,
      explainability: {
        modelVersion: loan.aiAnalysis?.modelVersion || null,
        probabilityOfDefault: explainPd,
        riskLevel: explainRisk,
        creditScore: loan.aiAnalysis?.creditScore || null,
        explanationSummary:
          loan.aiAnalysis?.shapFactors?.explanationSummary || [],
        flags: loan.aiAnalysis?.amlFlags || [],
        decisionSummary,
        alternate:
          loan.applicantType === "unbanked"
            ? {
                referenceId: loan.alternateReferenceId || null,
                scoringMethod: loan.alternateUnderwriting?.scoringMethod || null,
                adminAttached: loan.alternateUnderwriting?.adminAttached || null,
                explanationMetadata:
                  loan.alternateUnderwriting?.explanationMetadata || null,
                mlShap: loan.alternateUnderwriting?.explanationMetadata?.shap || null,
              }
            : null,
      },
      applicant: {
        id: loan.userId?._id || null,
        fullName: loan.userId?.fullName || null,
        email: loan.userId?.email || null,
        phone: loan.userId?.phone || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching explainability",
      error: error.message,
    });
  }
};

export const getAlternateVaultKeys = async (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  return res.status(200).json({ keys: listAlternateVaultKeys() });
};

export const attachAlternateVaultData = async (req, res) => {
  try {
    const { loanId } = req.params;
    const admin = await User.findById(req.user._id);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }
    const loan = await LoanApplication.findById(loanId);
    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }
    if (admin.adminLoanType && loan.loanType !== admin.adminLoanType) {
      return res.status(403).json({ message: "Not authorized for this loan type" });
    }
    if (loan.applicantType !== "unbanked") {
      return res.status(400).json({ message: "Only unbanked applications support vault attach" });
    }
    const ref = loan.alternateReferenceId || "";
    const vault = lookupAlternateVault(ref);
    if (!vault) {
      return res.status(404).json({
        message: `No demo vault data for reference ID "${ref}". Demo keys: ${listAlternateVaultKeys().join(", ")}`,
      });
    }
    const adminAttached = {
      upi: vault.upiSummary,
      utility: vault.utilitySummary,
      source: "vault",
      vaultKey: normalizeReferenceId(ref),
      qualityTier: vault.qualityTier,
      attachedAt: new Date(),
      attachedBy: req.user._id,
    };
    const pipe = await runUnbankedScoringPipeline({
      alternateData: loan.alternateUnderwriting?.alternateData || {},
      adminAttached,
      requestedAmount: loan.requestedAmount,
      requestedTenure: loan.requestedTenure,
      alternateUserSignals: loan.alternateUserSignals,
      consentAcknowledged: true,
    });
    applyUnbankedPipelineResultToLoan(loan, pipe);
    await loan.save();
    return res.status(200).json({
      message: "Demo vault summaries attached and application rescored",
      loan: attachDecisionSummary(loan),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Vault attach failed",
      error: error.message,
    });
  }
};

export const uploadVerifiedAlternateCsv = async (req, res) => {
  try {
    const { loanId } = req.params;
    const admin = await User.findById(req.user._id);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }
    const loan = await LoanApplication.findById(loanId);
    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }
    if (admin.adminLoanType && loan.loanType !== admin.adminLoanType) {
      return res.status(403).json({ message: "Not authorized for this loan type" });
    }
    if (loan.applicantType !== "unbanked") {
      return res.status(400).json({ message: "Only unbanked applications support verified CSV attach" });
    }

    const files = req.files || {};
    const upiFile = files.upi?.[0];
    const utilityFile = files.utility?.[0];
    let upiSummary = null;
    let utilitySummary = null;
    if (upiFile?.buffer) {
      const rows = parseCsv(upiFile.buffer.toString("utf-8"));
      if (rows.length) upiSummary = buildUpiSummary(rows);
    }
    if (utilityFile?.buffer) {
      const rows = parseCsv(utilityFile.buffer.toString("utf-8"));
      if (rows.length) utilitySummary = buildUtilitySummary(rows);
    }
    if (!upiSummary && !utilitySummary) {
      return res.status(400).json({
        message: "Provide at least one non-empty CSV (field name: upi and/or utility)",
      });
    }

    const adminAttached = {
      upi: upiSummary,
      utility: utilitySummary,
      source: "admin_upload",
      vaultKey: null,
      qualityTier: "medium",
      attachedAt: new Date(),
      attachedBy: req.user._id,
    };
    const pipe = await runUnbankedScoringPipeline({
      alternateData: loan.alternateUnderwriting?.alternateData || {},
      adminAttached,
      requestedAmount: loan.requestedAmount,
      requestedTenure: loan.requestedTenure,
      alternateUserSignals: loan.alternateUserSignals,
      consentAcknowledged: true,
    });
    applyUnbankedPipelineResultToLoan(loan, pipe);
    await loan.save();
    return res.status(200).json({
      message: "Verified CSV summaries attached and application rescored",
      loan: attachDecisionSummary(loan),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Verified upload failed",
      error: error.message,
    });
  }
};

// Get audit logs for this admin's actions
export const getAuditLogs = async (req, res) => {
  try {
    console.log(" getAuditLogs called");
    const admin = await User.findById(req.user._id);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    const query = {};
    if (admin.adminLoanType) {
      query.loanType = admin.adminLoanType;
    }

    // Build activity feed from all loans in admin scope so automatic and user actions are visible too.
    const activityHistory = await LoanApplication.find(query)
      .populate("userId", "fullName")
      .populate("adminDecision.adminId", "fullName")
      .sort({ updatedAt: -1, submittedAt: -1 })
      .limit(100);

    const logs = activityHistory
      .map((loan) => {
        const normalizedStatus = deriveEffectiveStatus(loan);
        const adminActorName =
          loan.adminDecision?.adminId?.fullName || admin.fullName || "Admin";

        let eventType = "Processed";
        let severity = "warning";
        let description = "Application updated";

        if (normalizedStatus === "approved") {
          eventType = "Approved";
          severity = "success";
          description = `Application approved by ${adminActorName}`;
        } else if (normalizedStatus === "rejected") {
          eventType = "Rejected";
          severity = "error";
          description = `Application rejected by ${adminActorName}`;
        } else if (normalizedStatus === "auto_approved") {
          eventType = "Auto Approved";
          severity = "success";
          description = "Application auto approved by policy engine";
        } else if (normalizedStatus === "auto_rejected") {
          eventType = "Auto Rejected";
          severity = "error";
          description = "Application auto rejected by policy engine";
        } else if (normalizedStatus === "accepted") {
          eventType = "Offer Accepted";
          severity = "success";
          description = "Loan offer accepted by applicant";
        } else if (normalizedStatus === "declined") {
          eventType = "Offer Declined";
          severity = "warning";
          description = "Loan offer declined by applicant";
        } else if (normalizedStatus === "disbursed") {
          eventType = "Disbursed";
          severity = "success";
          description = "Loan disbursed";
        } else if (["under_review", "pending", "hold"].includes(normalizedStatus)) {
          eventType = "Under Review";
          severity = "warning";
          description = "Application queued for manual underwriting review";
        } else {
          // Default for newly created loans
          eventType = "Submitted";
          severity = "info";
          description = "New application submitted for processing";
        }

        return {
          _id: `${loan._id}-${normalizedStatus}-${loan.updatedAt instanceof Date ? loan.updatedAt.toISOString() : String(loan.updatedAt)}`,
          applicantName: loan.userId?.fullName,
          eventType,
          description,
          timestamp:
            loan.adminDecision?.decidedAt || loan.updatedAt || loan.submittedAt,
          severity,
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    console.log(` Found ${logs.length} audit log entries`);

    return res.status(200).json({
      logs,
      adminLoanType: admin.adminLoanType || "all",
      message: "Audit logs fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error.message);
    return res.status(500).json({
      message: "Error fetching audit logs",
      error: error.message,
    });
  }
};
