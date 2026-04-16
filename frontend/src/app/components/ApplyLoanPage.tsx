import { useState, useRef, useEffect } from "react";
import { Shield, ChevronRight, CheckCircle2, AlertCircle, FileText, Briefcase, IndianRupee, Home, Car, GraduationCap, Store, CreditCard as CardIcon, Upload, Camera, InfoIcon, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { loanSessionService } from "../services/loanSessionService";
import { apiClient } from "../services/apiClient";

function formatInrDisplay(value: string | number | undefined | null): string {
  const raw = String(value ?? "").replace(/,/g, "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || raw === "") return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

export function ApplyLoanPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [step, setStep] = useState(0);

  // Form State
  const [applicantType, setApplicantType] = useState<"banked" | "unbanked" | null>(null);
  const [loanType, setLoanType] = useState<string | null>(null);
  const [incomeRange, setIncomeRange] = useState("");
  const [hasExistingLoan, setHasExistingLoan] = useState("no");
  const [existingEmi, setExistingEmi] = useState("");
  const [dependents, setDependents] = useState("0");
  const [coApplicant, setCoApplicant] = useState("none");
  const [loanAmount, setLoanAmount] = useState([50000]);
  const [tenure, setTenure] = useState("12");
  const [occupation, setOccupation] = useState("");

  // User Info State (from backend - read-only)
  const [userInfo, setUserInfo] = useState({
    fullName: '',
    email: '',
    phone: '',
  });
  const [loadingUserInfo, setLoadingUserInfo] = useState(true);

  // Personal Details State (from signup/profile)
  const [gender, setGender] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [familyMembersCount, setFamilyMembersCount] = useState("");
  const [childrenCount, setChildrenCount] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [age, setAge] = useState("");

  // Helper function to calculate age from date of birth
  const calculateAge = (dob: string) => {
    if (!dob) {
      setAge("");
      return "";
    }
    try {
      // Parse date in DD-MM-YYYY format
      const [day, month, year] = dob.split('-');
      const birthDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      const today = new Date();
      let calculatedAge = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        calculatedAge--;
      }
      const ageStr = calculatedAge.toString();
      setAge(ageStr); // Automatically set age state
      return ageStr;
    } catch {
      setAge("");
      return "";
    }
  };

  const mapIncomeRangeToAnnual = (range: string) => {
    const value = String(range || '').trim();
    const monthlyIncomeMap: Record<string, number> = {
      '<15k': 15000,
      '<25k': 25000,
      '15k-30k': 22500,
      '25-50k': 37500,
      '25k-50k': 37500,
      '50k-2L': 125000,
      '>30k': 40000,
      '>50k': 60000,
      '>2L': 250000,
    };
    const monthly = monthlyIncomeMap[value] || 0;
    return monthly > 0 ? monthly * 12 : null;
  };

  const deriveIncomeTypeForModel = (job: string) => {
    const value = String(job || '').toLowerCase();
    if (value.includes('student')) return 'Student';
    if (value.includes('self') || value.includes('business')) return 'Commercial associate';
    if (value.includes('retired')) return 'Pensioner';
    return 'Working';
  };

  // Document State
  const [identityFile, setIdentityFile] = useState<File | null>(null);
  const [financialFile, setFinancialFile] = useState<File | null>(null);

  // OCR State (additive — does not affect existing flow)
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ name?: string; dob?: string; idNumber?: string; identityVerified?: boolean } | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Education State
  const [courseName, setCourseName] = useState("");
  const [university, setUniversity] = useState("");
  const [studyLocation, setStudyLocation] = useState("India");
  const [courseDuration, setCourseDuration] = useState("2");

  // Home Loan State
  const [homeArea, setHomeArea] = useState("");
  const [bhk, setBhk] = useState("");
  const [homeLocation, setHomeLocation] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [propertyDocument, setPropertyDocument] = useState<File | null>(null);

  // Auto Loan State
  const [autoType, setAutoType] = useState("");
  const [autoModel, setAutoModel] = useState("");
  const [autoPrice, setAutoPrice] = useState("");
  const [autoDetails, setAutoDetails] = useState("");
  const [autoDocument, setAutoDocument] = useState<File | null>(null);

  // Business Loan State
  const [businessType, setBusinessType] = useState<"msme" | "large" | "">("");
  const [msmeCertificate, setMsmeCertificate] = useState<File | null>(null);

  // Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [activeCameraFor, setActiveCameraFor] = useState<"applicant" | "coApplicant" | null>(null);
  const [faceScanImage, setFaceScanImage] = useState<string | null>(null);
  const [coAppFaceScanImage, setCoAppFaceScanImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [disableAutoSave, setDisableAutoSave] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [assetsConfirmed, setAssetsConfirmed] = useState(false);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [alternateDataConsent, setAlternateDataConsent] = useState(false);
  const [upiMonthlyInflow, setUpiMonthlyInflow] = useState("");
  const [upiMonthlyOutflow, setUpiMonthlyOutflow] = useState("");
  const [avgMonthlyTransactionCount, setAvgMonthlyTransactionCount] = useState("");
  const [transactionRegularity, setTransactionRegularity] = useState("");
  const [upiInflowVariance, setUpiInflowVariance] = useState("");
  const [gstConsistency, setGstConsistency] = useState("");
  const [utilityPaymentRegularity, setUtilityPaymentRegularity] = useState("");
  const [rentPaymentConsistency, setRentPaymentConsistency] = useState("");
  const [declaredMonthlyIncome, setDeclaredMonthlyIncome] = useState("");
  const [employmentOrBusinessType, setEmploymentOrBusinessType] = useState("");
  const [monthsUpiHistory, setMonthsUpiHistory] = useState("");
  const [monthsGstHistory, setMonthsGstHistory] = useState("");
  const [monthsUtilityHistory, setMonthsUtilityHistory] = useState("");
  const [monthsRentHistory, setMonthsRentHistory] = useState("");
  const [showAdvancedUnbanked, setShowAdvancedUnbanked] = useState(false);
  const [quickApplyUnbanked, setQuickApplyUnbanked] = useState(true);
  const [alternateSourceType, setAlternateSourceType] = useState<"upi" | "utility">("upi");
  const [alternateDataFile, setAlternateDataFile] = useState<File | null>(null);
  const [alternateIngestionLoading, setAlternateIngestionLoading] = useState(false);
  const [alternateIngestionMessage, setAlternateIngestionMessage] = useState<string | null>(null);
  const [alternateIngestionSuccess, setAlternateIngestionSuccess] = useState(false);
  const [showIngestedOverride, setShowIngestedOverride] = useState(false);
  const [alternateReferenceId, setAlternateReferenceId] = useState("");
  const [alternateReferenceIdType, setAlternateReferenceIdType] = useState<
 "pan" | "bank_account_masked" | "other"
 >("pan");
  const [hasUpiHint, setHasUpiHint] = useState(false);
  const [hasUtilityHint, setHasUtilityHint] = useState(false);

  const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:8000/api';

  // Restore session on mount
  useEffect(() => {
    console.log(' ApplyLoanPage mounted');
    const savedSession = loanSessionService.loadFormState();
    const wasJustSubmitted = sessionStorage.getItem('loan_submitted') === 'true';

    console.log('📝 Saved session exists:', !!savedSession);
    console.log(' Was just submitted:', wasJustSubmitted);

    if (wasJustSubmitted) {
      // Just submitted - clear session and don't restore
      console.log('🧹 Clearing session after submission');
      loanSessionService.clearFormState();
      sessionStorage.removeItem('loan_submitted');
      setStep(0);
      setLoanType(null);
      return; // Don't restore session
    }

    if (savedSession) {
      // Restore all state from session
      if (savedSession.step) setStep(savedSession.step);
      if (savedSession.applicantType) setApplicantType(savedSession.applicantType as "banked" | "unbanked");
      if (savedSession.loanType) setLoanType(savedSession.loanType);
      if (savedSession.incomeRange) setIncomeRange(savedSession.incomeRange);
      if (savedSession.hasExistingLoan) setHasExistingLoan(savedSession.hasExistingLoan);
      if (savedSession.existingEmi) setExistingEmi(savedSession.existingEmi);
      if (savedSession.dependents) setDependents(savedSession.dependents);
      if (savedSession.coApplicant) setCoApplicant(savedSession.coApplicant);
      if (savedSession.loanAmount) setLoanAmount(savedSession.loanAmount);
      if (savedSession.tenure) setTenure(savedSession.tenure);
      if (savedSession.occupation) setOccupation(savedSession.occupation);
      if (savedSession.gender) setGender(savedSession.gender);
      if (savedSession.maritalStatus) setMaritalStatus(savedSession.maritalStatus);
      if (savedSession.familyMembersCount) setFamilyMembersCount(savedSession.familyMembersCount);
      if (savedSession.childrenCount) setChildrenCount(savedSession.childrenCount);
      if (savedSession.dateOfBirth) setDateOfBirth(savedSession.dateOfBirth);
      if (savedSession.age) setAge(savedSession.age);
      if (savedSession.courseName) setCourseName(savedSession.courseName);
      if (savedSession.university) setUniversity(savedSession.university);
      if (savedSession.studyLocation) setStudyLocation(savedSession.studyLocation);
      if (savedSession.courseDuration) setCourseDuration(savedSession.courseDuration);
      if (savedSession.homeArea) setHomeArea(savedSession.homeArea);
      if (savedSession.bhk) setBhk(savedSession.bhk);
      if (savedSession.homeLocation) setHomeLocation(savedSession.homeLocation);
      if (savedSession.estimatedPrice) setEstimatedPrice(savedSession.estimatedPrice);
      if (savedSession.autoType) setAutoType(savedSession.autoType);
      if (savedSession.autoModel) setAutoModel(savedSession.autoModel);
      if (savedSession.autoPrice) setAutoPrice(savedSession.autoPrice);
      if (savedSession.autoDetails) setAutoDetails(savedSession.autoDetails);
      if (savedSession.businessType) setBusinessType(savedSession.businessType);
      if (savedSession.faceScanImage) setFaceScanImage(savedSession.faceScanImage);
      if (savedSession.coAppFaceScanImage) setCoAppFaceScanImage(savedSession.coAppFaceScanImage);
      if (savedSession.alternateDataConsent) setAlternateDataConsent(Boolean(savedSession.alternateDataConsent));
      if (savedSession.upiMonthlyInflow) setUpiMonthlyInflow(savedSession.upiMonthlyInflow);
      if (savedSession.upiMonthlyOutflow) setUpiMonthlyOutflow(savedSession.upiMonthlyOutflow);
      if (savedSession.avgMonthlyTransactionCount) setAvgMonthlyTransactionCount(savedSession.avgMonthlyTransactionCount);
      if (savedSession.transactionRegularity) setTransactionRegularity(savedSession.transactionRegularity);
      if (savedSession.upiInflowVariance) setUpiInflowVariance(savedSession.upiInflowVariance);
      if (savedSession.gstConsistency) setGstConsistency(savedSession.gstConsistency);
      if (savedSession.utilityPaymentRegularity) setUtilityPaymentRegularity(savedSession.utilityPaymentRegularity);
      if (savedSession.rentPaymentConsistency) setRentPaymentConsistency(savedSession.rentPaymentConsistency);
      if (savedSession.declaredMonthlyIncome) setDeclaredMonthlyIncome(savedSession.declaredMonthlyIncome);
      if (savedSession.employmentOrBusinessType) setEmploymentOrBusinessType(savedSession.employmentOrBusinessType);
      if (savedSession.monthsUpiHistory) setMonthsUpiHistory(savedSession.monthsUpiHistory);
      if (savedSession.monthsGstHistory) setMonthsGstHistory(savedSession.monthsGstHistory);
      if (savedSession.monthsUtilityHistory) setMonthsUtilityHistory(savedSession.monthsUtilityHistory);
      if (savedSession.monthsRentHistory) setMonthsRentHistory(savedSession.monthsRentHistory);
      if (savedSession.quickApplyUnbanked !== undefined) {
        setQuickApplyUnbanked(Boolean(savedSession.quickApplyUnbanked));
      }
      if (savedSession.alternateReferenceId) setAlternateReferenceId(savedSession.alternateReferenceId);
      if (savedSession.alternateReferenceIdType) {
        setAlternateReferenceIdType(
          savedSession.alternateReferenceIdType as "pan" | "bank_account_masked" | "other"
        );
      }
      if (savedSession.hasUpiHint !== undefined) setHasUpiHint(Boolean(savedSession.hasUpiHint));
      if (savedSession.hasUtilityHint !== undefined) setHasUtilityHint(Boolean(savedSession.hasUtilityHint));

      console.log("✓ Loan application session restored");
    }
  }, []);

  // Fetch user info from backend on mount
  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        console.log(' Fetching user profile from:', `${API_BASE_URL}/user/profile`);

        const response = await apiClient.get(`${API_BASE_URL}/user/profile`);

        console.log(' Response status:', response.status);

        if (response.ok) {
          const data = await response.json();
          console.log(' User profile received:', data);
          setUserInfo({
            fullName: data.user?.fullName || data.fullName || '',
            email: data.user?.email || data.email || '',
            phone: data.user?.phone || data.phone || '',
          });
          console.log('✓ User info state updated');
        } else {
          const error = await response.text();
          console.error('Failed to fetch profile:', response.status, error);
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      } finally {
        setLoadingUserInfo(false);
      }
    };

    fetchUserInfo();
  }, []);

  // Save form state to session whenever it changes (but NOT during submission)
  useEffect(() => {
    if (loanType && !disableAutoSave) { // Only save if a loan type has been selected AND not submitting
      loanSessionService.saveFormState({
        step,
        applicantType,
        loanType,
        incomeRange,
        hasExistingLoan,
        existingEmi,
        dependents,
        coApplicant,
        loanAmount,
        tenure,
        occupation,
        gender,
        maritalStatus,
        familyMembersCount,
        childrenCount,
        dateOfBirth,
        age,
        courseName,
        university,
        studyLocation,
        courseDuration,
        homeArea,
        bhk,
        homeLocation,
        estimatedPrice,
        autoType,
        autoModel,
        autoPrice,
        autoDetails,
        businessType,
        faceScanImage,
        coAppFaceScanImage,
        alternateDataConsent,
        upiMonthlyInflow,
        upiMonthlyOutflow,
        avgMonthlyTransactionCount,
        transactionRegularity,
        upiInflowVariance,
        gstConsistency,
        utilityPaymentRegularity,
        rentPaymentConsistency,
        declaredMonthlyIncome,
        employmentOrBusinessType,
        monthsUpiHistory,
        monthsGstHistory,
        monthsUtilityHistory,
        monthsRentHistory,
        quickApplyUnbanked,
        alternateReferenceId,
        alternateReferenceIdType,
        hasUpiHint,
        hasUtilityHint,
      });
    }
  }, [step, applicantType, loanType, incomeRange, hasExistingLoan, existingEmi, dependents, coApplicant, loanAmount, tenure, occupation, gender, maritalStatus, familyMembersCount, childrenCount, dateOfBirth, age, courseName, university, studyLocation, courseDuration, homeArea, bhk, homeLocation, estimatedPrice, autoType, autoModel, autoPrice, autoDetails, businessType, faceScanImage, coAppFaceScanImage, alternateDataConsent, upiMonthlyInflow, upiMonthlyOutflow, avgMonthlyTransactionCount, transactionRegularity, upiInflowVariance, gstConsistency, utilityPaymentRegularity, rentPaymentConsistency, declaredMonthlyIncome, employmentOrBusinessType, monthsUpiHistory, monthsGstHistory, monthsUtilityHistory, monthsRentHistory, quickApplyUnbanked, alternateReferenceId, alternateReferenceIdType, hasUpiHint, hasUtilityHint, disableAutoSave]);

  // Camera Handlers
  const startCamera = (forWhom: "applicant" | "coApplicant") => {
    setActiveCameraFor(forWhom);
    setIsCameraOpen(true);
  };

  useEffect(() => {
    let currentStream: MediaStream | null = null;

    if (isCameraOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        currentStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please check your browser permissions.");
        setIsCameraOpen(false);
        setActiveCameraFor(null);
      }
    };

    if (isCameraOpen) {
      initCamera();
    }

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      document.body.style.overflow = "auto";
    };
  }, [isCameraOpen]);

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg");
        if (activeCameraFor === "applicant") {
          setFaceScanImage(dataUrl);
        } else {
          setCoAppFaceScanImage(dataUrl);
        }
      }
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
    setActiveCameraFor(null);
  };

  const loanOptions = [
    { id: "personal", title: "Personal Loan", icon: IndianRupee, desc: "For medical, wedding or travel needs" },
    { id: "education", title: "Education Loan", icon: GraduationCap, desc: "Invest in your future" },
    { id: "home", title: "Home Loan", icon: Home, desc: "Build your dream home" },
    { id: "auto", title: "Automobile Loan", icon: Car, desc: "Drive home your new vehicle" },
    { id: "business", title: "Business Loan", icon: Store, desc: "Grow your MSME business" },
    { id: "credit_card", title: "Credit Card", icon: CardIcon, desc: "Build credit with everyday spends" },
  ];

  const occupations = [
    "Salaried", "Self-employed", "Farmer", "Homemaker", "Retired", "Gig Worker", "Student", "Unemployed"
  ];

  const getLoanAmountConfig = () => {
    if (loanType === 'home') {
      return {
        min: 500000,
        max: 50000000, // 5 Cr
        step: 50000,
        minLabel: "₹5L",
        maxLabel: "₹5Cr+",
        recLabel: "Recommended: ₹20L - ₹1Cr"
      };
    }
    if (loanType === 'auto') {
      return {
        min: 100000,
        max: 20000000, // 2 Cr
        step: 25000,
        minLabel: "₹1L",
        maxLabel: "₹2Cr+",
        recLabel: "Recommended: ₹5L - ₹20L"
      };
    }
    if (loanType === 'business') {
      return {
        min: 100000,
        max: 50000000, // 5 Cr
        step: 50000,
        minLabel: "₹1L",
        maxLabel: "₹5Cr+",
        recLabel: "Recommended: ₹10L - ₹50L"
      };
    }
    // Default (Personal, Education, Farmer, Credit Card, etc)
    return {
      min: 10000,
      max: 1000000, // 10L
      step: 5000,
      minLabel: "₹10K",
      maxLabel: "₹10L+",
      recLabel: "Recommended: ₹50K - ₹2L"
    };
  };

  const loanConfig = getLoanAmountConfig();

  // EMI Calculation
  const calculateEMI = (principal: number, months: number, ratePerYear = 14) => {
    const r = ratePerYear / 12 / 100;
    if (r === 0) return principal / months;
    return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  };

  const emi = calculateEMI(loanAmount[0], parseInt(tenure) || 12);
  const totalPayable = emi * (parseInt(tenure) || 12);
  const totalInterest = totalPayable - loanAmount[0];

  // Mock checking EMI risk
  // Assume generic income mapping for calculation purposes
  const getIncomeValue = () => {
    if (applicantType === "unbanked") {
      const declared = Number(declaredMonthlyIncome || 0);
      const inflow = Number(upiMonthlyInflow || 0);
      return Math.max(declared, inflow, 30000);
    }
    if (incomeRange === "<2L") return 15000;
    if (incomeRange === "2-5L") return 30000;
    if (incomeRange === "5-10L") return 60000;
    if (incomeRange === ">10L") return 100000;
    return 30000; // default fallback
  };

  const assumedMonthlyIncome = getIncomeValue();
  const emiPercentage = (emi / assumedMonthlyIncome) * 100;

  const getEmiRisk = () => {
    if (applicantType !== "unbanked" && !incomeRange) {
      return { text: "Select income to see risk", color: "text-gray-400", bg: "bg-gray-400/10" };
    }
    if (applicantType === "unbanked" && !declaredMonthlyIncome && !upiMonthlyInflow) {
      return { text: "Enter declared income or UPI inflow to see risk", color: "text-gray-400", bg: "bg-gray-400/10" };
    }
    if (emiPercentage < 30) return { text: "Comfortable (below 30%)", color: "text-green-400", bg: "bg-green-400/10" };
    if (emiPercentage <= 40) return { text: "Manageable (30-40%)", color: "text-yellow-400", bg: "bg-yellow-400/10" };
    return { text: "High risk (above 40%)", color: "text-red-400", bg: "bg-red-400/10" };
  };

  // Validation function for required fields
  const validateRequiredFields = () => {
    const errors: string[] = [];

    // Core loan details
    if (!loanType) errors.push("Loan type is required");
    if (!loanAmount[0]) errors.push("Loan amount is required");
    if (!tenure) errors.push("Tenure is required");
    if (applicantType !== "unbanked" && !incomeRange) errors.push("Income range is required");
    if (!applicantType) errors.push("Applicant type is required");

    // Personal details
    if (!dateOfBirth) errors.push("Date of birth is required");
    if (!age) errors.push("Age is required (calculated from DOB)");
    if (!gender) errors.push("Gender is required");
    if (!maritalStatus) errors.push("Marital status is required");
    if (loanType !== 'education' && !occupation) errors.push("Occupation/Purpose is required");

    // Loan-type specific validations
    if (loanType === 'education') {
      if (!courseName) errors.push("Course name is required for education loans");
      if (!university) errors.push("University name is required for education loans");
      if (!courseDuration) errors.push("Course duration is required for education loans");
    }

    if (loanType === 'home') {
      if (!homeArea) errors.push("Home area is required for home loans");
      if (!bhk) errors.push("BHK/Rooms is required for home loans");
      if (!homeLocation) errors.push("Home location is required for home loans");
      if (!estimatedPrice) errors.push("Estimated price is required for home loans");
    }

    if (loanType === 'auto') {
      if (!autoType) errors.push("Vehicle type is required for auto loans");
      if (!autoModel) errors.push("Vehicle model is required for auto loans");
      if (!autoPrice) errors.push("Vehicle price is required for auto loans");
    }

    if (loanType === 'business') {
      if (!businessType) errors.push("Business type (MSME/Large) is required for business loans");
    }

    if (applicantType === "unbanked") {
      if (!alternateDataConsent) errors.push("Alternate data consent is required");
      const refOk = String(alternateReferenceId || "").trim().length >= 4;
      if (!refOk) errors.push("Reference ID is required (e.g. PAN or bank reference, min 4 characters)");
      if (!quickApplyUnbanked) {
        if (!upiMonthlyOutflow) errors.push("Monthly UPI outflow is required");
        if (!avgMonthlyTransactionCount)
          errors.push("Average monthly transaction count is required");
        if (!transactionRegularity)
          errors.push("Transaction regularity score is required");
      }
      if (!declaredMonthlyIncome && !upiMonthlyInflow)
        errors.push("Monthly inflow or declared income is required");
    }

    return errors;
  };

  // OCR upload handler — additive, does not change existing submit/validation
  const handleIdentityFileChange = async (file: File | null) => {
    setIdentityFile(file);
    setOcrResult(null);
    setOcrError(null);
    if (!file) return;
    setOcrLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const form = new FormData();
      form.append('document', file);
      const res = await fetch(`${API_BASE_URL}/loan/upload-document`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.softAccept) {
          setOcrResult(null);
        } else {
          setOcrResult({
            name: data.name,
            dob: data.dob,
            idNumber: data.idNumber,
            identityVerified: data.identityVerified,
          });
        }
        setOcrError(null);
      } else {
        setOcrError(null);
        setOcrResult(null);
      }
    } catch (e: any) {
      console.warn("Identity document upload optional OCR:", e);
      setOcrError(null);
      setOcrResult(null);
    } finally {
      setOcrLoading(false);
    }
  };

  const handleAlternateDataUpload = async () => {
    if (!alternateDataFile) {
      setAlternateIngestionMessage("Please choose a CSV file first.");
      return;
    }
    setAlternateIngestionLoading(true);
    setAlternateIngestionMessage(null);
    try {
      const token = localStorage.getItem("accessToken");
      const form = new FormData();
      form.append("file", alternateDataFile);
      form.append("sourceType", alternateSourceType);
      const res = await fetch(`${API_BASE_URL}/loan/upload-alternate-data`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setAlternateIngestionSuccess(false);
        setAlternateIngestionMessage(data?.message || "Could not parse alternate data file.");
        return;
      }
      const summary = data?.summary || {};
      if (alternateSourceType === "upi") {
        if (summary.monthlyInflow != null) setUpiMonthlyInflow(String(summary.monthlyInflow));
        if (summary.monthlyOutflow != null) setUpiMonthlyOutflow(String(summary.monthlyOutflow));
        if (summary.avgMonthlyTransactionCount != null) setAvgMonthlyTransactionCount(String(summary.avgMonthlyTransactionCount));
        if (summary.transactionRegularity != null) setTransactionRegularity(String(summary.transactionRegularity));
        if (summary.monthsHistory != null) setMonthsUpiHistory(String(summary.monthsHistory));
      } else {
        if (summary.utilityPaymentRegularity != null) setUtilityPaymentRegularity(String(summary.utilityPaymentRegularity));
        if (summary.monthsHistory != null) setMonthsUtilityHistory(String(summary.monthsHistory));
      }
      setAlternateIngestionSuccess(true);
      setShowIngestedOverride(false);
      setAlternateIngestionMessage("Alternate data ingested successfully. Review and submit.");
    } catch {
      setAlternateIngestionSuccess(false);
      setAlternateIngestionMessage("Upload failed. Please try again.");
    } finally {
      setAlternateIngestionLoading(false);
    }
  };

  const handleSubmit = async () => {
    // Validate required fields first
    const validationErrors = validateRequiredFields();
    if (validationErrors.length > 0) {
      setSubmitError(validationErrors.join(", "));
      console.error('Validation errors:', validationErrors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsSubmitting(true);
    setDisableAutoSave(true); // Disable auto-save during submission
    setSubmitError(null);

    try {
      // Map collateral type based on loan type
      const getCollateralType = () => {
        switch (loanType) {
          case 'home': return 'property';
          case 'auto': return 'vehicle';
          default: return 'none';
        }
      };

      const collateralEstimatedValue =
        loanType === 'home' ? Number(estimatedPrice || 0) :
          loanType === 'auto' ? Number(autoPrice || 0) :
            loanAmount[0];

      const resolvedOccupation = loanType === 'education' ? (occupation || 'Student') : occupation;
      const resolvedIncomeAnnual =
        applicantType === "unbanked"
          ? (declaredMonthlyIncome ? Number(declaredMonthlyIncome) * 12 : null)
          : mapIncomeRangeToAnnual(incomeRange);
      const educationDetails = loanType === 'education'
        ? {
          courseName,
          university,
          studyLocation,
          courseDurationYears: Number(courseDuration),
        }
        : undefined;

      // Prepare loan application data for backend
      const applicationPayload = {
        applicantType,
        loanType,
        requestedAmount: loanAmount[0],
        requestedTenure: Number(tenure),
        purpose: loanType === 'education' ? (courseName || 'Education Loan') : (resolvedOccupation || "General"),
        dateOfBirth: dateOfBirth,
        age: age ? Number(age) : undefined,
        // OCR identity verification result (additive signal for scoring)
        identityVerified: ocrResult?.identityVerified ?? false,
        collateral: {
          type: getCollateralType(),
          estimatedValue: collateralEstimatedValue || loanAmount[0],
        },
        applicantProfile: {
          occupation: resolvedOccupation || null,
          incomeAnnual: resolvedIncomeAnnual,
          incomeType: deriveIncomeTypeForModel(resolvedOccupation),
          familyMembersCount: familyMembersCount ? Number(familyMembersCount) : null,
          childrenCount: childrenCount ? Number(childrenCount) : null,
          gender: gender || null,
          maritalStatus: maritalStatus || null,
          hasExistingLoan,
          existingEmi: existingEmi ? Number(existingEmi) : null,
        },
        ...(applicantType === "unbanked" && {
          alternateDataConsent,
          alternateReferenceId: String(alternateReferenceId || "").trim().toUpperCase(),
          alternateReferenceIdType,
          alternateUserSignals: {
            hasUpiHint,
            hasUtilityHint,
          },
          alternateData: {
            quickApply: quickApplyUnbanked,
            userSuppliedCsv: Boolean(alternateIngestionSuccess),
            upi: {
              monthlyInflow: upiMonthlyInflow ? Number(upiMonthlyInflow) : 0,
              monthlyOutflow: upiMonthlyOutflow ? Number(upiMonthlyOutflow) : (quickApplyUnbanked ? 0 : 0),
              avgMonthlyTransactionCount: avgMonthlyTransactionCount
                ? Number(avgMonthlyTransactionCount)
                : (quickApplyUnbanked ? 12 : 0),
              transactionRegularity: transactionRegularity
                ? Number(transactionRegularity)
                : (quickApplyUnbanked ? 0.55 : 0),
              inflowVariance: upiInflowVariance ? Number(upiInflowVariance) : 0,
            },
            gst: {
              filingConsistency: gstConsistency ? Number(gstConsistency) : 0,
            },
            utility: {
              paymentRegularity: utilityPaymentRegularity
                ? Number(utilityPaymentRegularity)
                : 0,
            },
            rent: {
              paymentConsistency: rentPaymentConsistency
                ? Number(rentPaymentConsistency)
                : 0,
            },
            monthsOfHistory: {
              upi: monthsUpiHistory ? Number(monthsUpiHistory) : 0,
              gst: monthsGstHistory ? Number(monthsGstHistory) : 0,
              utility: monthsUtilityHistory ? Number(monthsUtilityHistory) : 0,
              rent: monthsRentHistory ? Number(monthsRentHistory) : 0,
            },
            declaredIncome: {
              monthlyIncome: declaredMonthlyIncome
                ? Number(declaredMonthlyIncome)
                : 0,
            },
            employmentType: employmentOrBusinessType || null,
          },
        }),
        ...(loanType === 'education' && { educationDetails }),
        ...(loanType === 'home' && {
          homeDetails: {
            area: homeArea ? Number(homeArea) : null,
            bhk: bhk || null,
            location: homeLocation || null,
            propertyType: null,
          },
        }),
        ...(loanType === 'auto' && {
          autoDetails: {
            vehicleType: autoType || null,
            model: autoModel || null,
            registrationNumber: null,
            estimatedValue: autoPrice ? Number(autoPrice) : null,
          },
        }),
        ...(loanType === 'business' && {
          businessDetails: {
            businessType: businessType || null,
            businessName: null,
            yearsInOperation: null,
            annualTurnover: null,
          },
        }),
      };

      console.log('Submitting loan application:', applicationPayload);

      // Call backend API - apiClient handles token refresh automatically
      const response = await apiClient.post(`${API_BASE_URL}/loan/apply`, applicationPayload);

      console.log('Response received:', response.status, response.statusText);

      if (response.ok) {
        const data = await response.json();
        console.log('Loan application submitted successfully:', data);

        // Set submission flag BEFORE clearing session
        sessionStorage.setItem('loan_submitted', 'true');

        // Clear session immediately (before state reset)
        loanSessionService.clearFormState();
        console.log('Session cleared');

        // Reset all form state immediately
        setStep(0);
        setApplicantType(null);
        setLoanType(null);
        setIncomeRange("");
        setHasExistingLoan("no");
        setExistingEmi("");
        setDependents("0");
        setCoApplicant("none");
        setLoanAmount([50000]);
        setTenure("12");
        setOccupation("");
        setGender("");
        setMaritalStatus("");
        setFamilyMembersCount("");
        setChildrenCount("");
        setDateOfBirth("");
        setAge("");
        setAlternateDataConsent(false);
        setUpiMonthlyInflow("");
        setUpiMonthlyOutflow("");
        setAvgMonthlyTransactionCount("");
        setTransactionRegularity("");
        setUpiInflowVariance("");
        setGstConsistency("");
        setUtilityPaymentRegularity("");
        setRentPaymentConsistency("");
        setDeclaredMonthlyIncome("");
        setEmploymentOrBusinessType("");
        setMonthsUpiHistory("");
        setMonthsGstHistory("");
        setMonthsUtilityHistory("");
        setMonthsRentHistory("");
        setQuickApplyUnbanked(true);
        setAlternateIngestionSuccess(false);
        setShowIngestedOverride(false);
        setAlternateReferenceId("");
        setAlternateReferenceIdType("pan");
        setHasUpiHint(false);
        setHasUtilityHint(false);
        console.log('Form state reset');

        // Navigate to My Loans to show submitted application
        setTimeout(() => {
          console.log('Navigating to /my-loans');
          navigate("/my-loans");
        }, 500);
      } else {
        const error = await response.json();
        const errorMsg = error?.message || `Failed to submit application (Status: ${response.status})`;
        setSubmitError(errorMsg);
        console.error('Application submission failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorMsg
        });
        setDisableAutoSave(false); // Re-enable auto-save if submission failed
      }
    } catch (error: any) {
      setSubmitError(error?.message || 'An error occurred while submitting your application.');
      console.error('Error submitting application:', error);
      setDisableAutoSave(false); // Re-enable auto-save if submission failed
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = () => {
    let errors: string[] = [];
    if (step === 1) {
      if (!dateOfBirth) errors.push("- Date of Birth");
      if (!gender) errors.push("- Gender");
      if (!maritalStatus) errors.push("- Marital Status");
      if (applicantType !== "unbanked" && !incomeRange) errors.push("- Income Range");
      if (applicantType === "unbanked" && !alternateDataConsent) errors.push("- Alternate data consent");
    } else if (step === 2) {
      if (loanType === 'education') {
        if (!courseName) errors.push("- Course Name");
        if (!university) errors.push("- University");
        if (!courseDuration) errors.push("- Course Duration");
      } else {
        if (loanType === 'business' && !businessType) errors.push("- Business Enterprise Type");
        if (loanType !== 'business' && !occupation) errors.push("- Occupation Status");
      }
    } else if (step === 3 && loanType !== 'education') {
      if (loanType === 'home') {
        if (!homeLocation) errors.push("- Property Location");
        if (!bhk) errors.push("- Configuration (BHK)");
        if (!homeArea) errors.push("- Carpet Area");
        if (!estimatedPrice) errors.push("- Estimated Price");
      } else if (loanType === 'auto') {
        if (!autoType) errors.push("- Automobile Type");
        if (!autoModel) errors.push("- Model & Brand");
        if (!autoPrice) errors.push("- Estimated Price");
      }
      if (!assetsConfirmed) errors.push("- Please confirm the assets are correct");
      if (!finalConfirmed) errors.push("- Please confirm the information accuracy");
    }
    
    if (errors.length > 0) {
      setStepError(errors.map(e => e.replace("- ", "")).join(", "));
      return;
    }
    setStepError(null);
    setStep(prev => Math.min(prev + 1, 4));
  };
  const prevStep = () => {
    setStepError(null);
    setStep(prev => Math.max(prev - 1, 0));
  };

  return (
    <div className="apply-loan-brutal min-h-screen bg-white flex flex-col text-black font-sans selection:bg-blue-600 selection:text-white overflow-x-hidden">
      {/* Header */}
      <header className="border-b-[1.5px] border-black bg-white flex-shrink-0 sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6 md:px-12">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => navigate("/")}>
              <span className="text-xl md:text-2xl font-black tracking-tighter uppercase relative">
                CREDIT
                <span className="absolute -right-2.5 bottom-1.5 w-1.5 h-1.5 md:w-2 mb:h-2 bg-blue-600"></span>
              </span>
            </div>
            <nav className="hidden md:flex items-center gap-10">
              <button className="text-blue-600 text-[10px] md:text-xs font-black uppercase tracking-[0.2em] border-b-[2px] border-blue-600 pb-[2px]">Apply For Loan</button>
              <button onClick={() => navigate("/my-loans")} className="text-black/60 hover:text-black hover:opacity-100 transition-opacity text-[10px] md:text-xs font-black uppercase tracking-[0.2em]">My Loans</button>
              <button onClick={() => navigate("/profile")} className="text-black/60 hover:text-black hover:opacity-100 transition-opacity text-[10px] md:text-xs font-black uppercase tracking-[0.2em]">Profile</button>
            </nav>
            <Button
              onClick={() => {
                logout();
              }}
              variant="outline"
              className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-[10px] md:text-xs px-6 py-2 uppercase tracking-[0.2em] transition-all"
            >
              SIGN OUT &rarr;
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[85%] w-full mx-auto py-12">
        {/* Progress Bar for steps 1-4 */}
        {step > 0 && (
          <div className="mb-12">
            <div className="flex items-start justify-between mb-8">
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-1">Apply for a Loan</h1>
                <p className="text-blue-600 text-xs font-bold uppercase tracking-[0.2em]">{loanOptions.find(opt => opt.id === loanType)?.title}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-black/50 hover:text-black hover:bg-gray-100 border-[1.5px] border-black/10 rounded-none font-bold text-xs uppercase tracking-widest" onClick={() => { loanSessionService.clearFormState(); setLoanType(null); setStep(0); }}>
                <X className="w-4 h-4 mr-2" /> Cancel
              </Button>
            </div>

            {/* <div className="flex justify-between text-xs font-medium text-slate-600 mb-2 px-1">
              {loanType === 'education' ? (
                <>
                  <span>Basic Info</span>
                  <span>Study & Loan</span>
                  <span>Review & Submit</span>
                </>
              ) : (
                <>
                  <span>Basic Info</span>
                  <span>Loan Config</span>
                  <span>Details</span>
                  <span>Review</span>
                </>
              )}
            </div> */}
            <div className="flex gap-1 h-2">
              {(loanType === 'education' ? [1, 2, 3] : [1, 2, 3, 4]).map((i) => (
                <div key={i} className={`flex-1 transition-colors duration-300 ${step >= i ? 'bg-blue-600' : 'bg-black/10'}`} />
              ))}
            </div>
            <p className="text-center text-xs text-black/40 mt-4 font-bold uppercase tracking-[0.3em]">Step {step} of {loanType === 'education' ? 3 : 4}</p>
          </div>
        )}

        {/* STEP 0: Introduction & Type Selection */}
        {step === 0 && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-12">
              <h1 className="text-[10vw] md:text-[6vw] lg:text-[5rem] leading-[0.85] font-black tracking-tighter uppercase mb-6">
                APPLY FOR<br />
                <span className="text-blue-600">A LOAN.</span>
              </h1>
              <p className="font-bold text-lg md:text-xl text-black/50 uppercase tracking-wide max-w-lg">Get personalized loan options and build your financial profile.</p>
            </div>

            <div className="border-[2px] border-black p-6 md:p-8 bg-white shadow-[8px_8px_0_0_rgba(0,0,0,1)] hover:shadow-[12px_12px_0_0_rgba(0,0,0,1)] hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-4">Things to Keep in Mind</h3>
                  <ul className="text-sm text-black/70 space-y-2 font-bold">
                    <li className="flex items-start gap-2"><span className="text-blue-600 font-black">•</span>Keep EMI within 30–40% of your income</li>
                    <li className="flex items-start gap-2"><span className="text-blue-600 font-black">•</span>Start with smaller loans if you are new to credit</li>
                    <li className="flex items-start gap-2"><span className="text-blue-600 font-black">•</span>Adding a co-applicant improves approval chances</li>
                    <li className="flex items-start gap-2"><span className="text-blue-600 font-black">•</span>Choose loan based on need, not maximum eligibility</li>
                    <li className="flex items-start gap-2"><span className="text-blue-600 font-black">•</span>Timely repayment increases future loan limits</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <h2 className="text-xs font-black tracking-[0.3em] uppercase mb-4 text-black/40">SELECT CREDIT PROFILE</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <button
                  type="button"
                  onClick={() => {
                    setApplicantType("banked");
                    setStepError(null);
                  }}
                  className={`text-left p-6 border-[1.5px] transition-all ${
                    applicantType === "banked"
                      ? "border-blue-600 bg-blue-50"
                      : "border-black bg-white"
                  }`}
                >
                  <p className="font-black text-sm uppercase tracking-wide">I have formal credit history (Banked)</p>
                  <p className="text-xs text-black/60 mt-2 font-bold">Use existing bureau + profile based underwriting.</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApplicantType("unbanked");
                    setStepError(null);
                  }}
                  className={`text-left p-6 border-[1.5px] transition-all ${
                    applicantType === "unbanked"
                      ? "border-blue-600 bg-blue-50"
                      : "border-black bg-white"
                  }`}
                >
                  <p className="font-black text-sm uppercase tracking-wide">I do not have formal credit history (Unbanked)</p>
                  <p className="text-xs text-black/60 mt-2 font-bold">Get assessed on UPI, utility and alternate cashflow behavior.</p>
                </button>
              </div>
              <h2 className="text-xs font-black tracking-[0.3em] uppercase mb-8 text-black/40">SELECT LOAN TYPE</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {loanOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (!applicantType) {
                        setStepError("Select banked or unbanked before loan type");
                        return;
                      }
                      setLoanType(option.id);
                      nextStep();
                    }}
                    className="text-left group p-8 md:p-10 flex flex-col gap-5 bg-white border-[1.5px] border-black hover:-translate-y-1 hover:shadow-[6px_6px_0_0_rgba(0,0,0,1)] transition-all duration-300 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      {/* {(() => {
                        const Icon = option.icon;
                        return <Icon className="w-5 h-5 text-blue-600 transition-colors duration-300" />;
                      })()} */}
                      <h3 className="font-black text-base md:text-lg uppercase tracking-tight text-black transition-colors duration-300">{option.title}</h3>
                    </div>
                    <p className="text-[10px] md:text-xs text-black/40 font-bold tracking-widest uppercase transition-colors duration-300">{option.desc}</p>
                    <div className="mt-auto pt-2 flex items-center text-xs font-black text-blue-600 uppercase tracking-[0.15em] group-hover:tracking-[0.2em] transition-all duration-300">
                      APPLY NOW <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform duration-300" />
                    </div>
                  </button>
                ))}
              </div>
              {stepError && (
                <p className="text-xs font-bold text-red-700 mt-4 uppercase tracking-wide">{stepError}</p>
              )}
            </div>
          </div>
        )}

        {/* STEP 1: Basic Information */}
        {step === 1 && loanType !== 'education' && (
          <form onSubmit={(e) => { e.preventDefault(); nextStep(); }} className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-300">
            <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase">YOUR BASIC DETAILS</h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <Card className="bg-white border-slate-300">
                  <CardContent className="p-6 space-y-6">
                    {/* Pre-filled readonly */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-black text-black/40 uppercase tracking-[0.2em] border-b-[1.5px] border-black/10 pb-3">PRE-FILLED IDENTITY (FROM SIGNUP)</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Full Name</Label>
                          <Input value={loadingUserInfo ? "Loading..." : userInfo.fullName} readOnly className="bg-slate-100 border-slate-300 text-slate-900" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Date of Birth <span className="text-red-500">*</span></Label>
                          <Input value={dateOfBirth} onChange={(e) => { setDateOfBirth(e.target.value); calculateAge(e.target.value); }} className="bg-white border-slate-300 text-slate-900" placeholder="DD-MM-YYYY" required />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Age (Years)</Label>
                          <Input value={age} readOnly className="bg-slate-100 border-slate-300 text-slate-900" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Phone Number</Label>
                          <Input value={loadingUserInfo ? "Loading..." : userInfo.phone} readOnly className="bg-slate-100 border-slate-300 text-slate-900" />
                        </div>
                        <div className="space-y-1.5 col-span-2">
                          <Label className="text-slate-600 text-xs">Email</Label>
                          <Input value={loadingUserInfo ? "Loading..." : userInfo.email} readOnly className="bg-slate-100 border-slate-300 text-slate-900" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-slate-200">
                      <h3 className="text-sm font-medium text-slate-700">Personal Information</h3>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Gender <span className="text-red-500">*</span></Label>
                          <Select value={gender} onValueChange={setGender}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                              <SelectItem value="prefer-not">Prefer not to say</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Marital Status <span className="text-red-500">*</span></Label>
                          <Select value={maritalStatus} onValueChange={setMaritalStatus}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="single">Single</SelectItem>
                              <SelectItem value="married">Married</SelectItem>
                              <SelectItem value="divorced">Divorced</SelectItem>
                              <SelectItem value="widowed">Widowed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Number of Family Members</Label>
                          <Select value={familyMembersCount} onValueChange={setFamilyMembersCount}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select count" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                              <SelectItem value="4">4</SelectItem>
                              <SelectItem value="5">5</SelectItem>
                              <SelectItem value="6+">6 or more</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {maritalStatus === "married" && (
                          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                            <Label className="text-slate-600 text-xs">Number of Children</Label>
                            <Select value={childrenCount} onValueChange={setChildrenCount}>
                              <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                                <SelectValue placeholder="Select count" />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-slate-300 text-slate-900">
                                <SelectItem value="0">0</SelectItem>
                                <SelectItem value="1">1</SelectItem>
                                <SelectItem value="2">2</SelectItem>
                                <SelectItem value="3">3</SelectItem>
                                <SelectItem value="4+">4 or more</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-slate-200">
                      <h3 className="text-sm font-medium text-slate-700">Financial Profile</h3>

                      {applicantType !== "unbanked" ? (
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Annual Income Range <span className="text-red-500">*</span></Label>
                          <Select value={incomeRange} onValueChange={setIncomeRange}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select income range" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="<2L">Less than ₹2 Lakhs</SelectItem>
                              <SelectItem value="2-5L">₹2 - ₹5 Lakhs</SelectItem>
                              <SelectItem value="5-10L">₹5 - ₹10 Lakhs</SelectItem>
                              <SelectItem value=">10L">Above ₹10 Lakhs</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="space-y-1.5 border border-blue-200 bg-blue-50 p-4">
                          <Label className="text-slate-700 text-xs font-bold">Alternate underwriting inputs (Unbanked)</Label>
                          <p className="text-[11px] text-slate-600">Start with only required basics. Add advanced details only if available.</p>
                          <div className="space-y-3 pt-2 border-t border-blue-100">
                            <div className="space-y-1.5">
                              <Label className="text-slate-800 text-xs">
                                Reference ID (PAN / masked bank reference) <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                placeholder="e.g. AAAAA1111A for demo vault"
                                value={alternateReferenceId}
                                onChange={(e) => setAlternateReferenceId(e.target.value.toUpperCase())}
                                className="bg-white border-slate-300 font-mono text-sm uppercase"
                              />
                              <p className="text-[10px] text-slate-600">
                                Used to match verified payment extracts on the bank side. Self-uploaded CSVs below are optional and marked
                                unverified until an analyst attaches proof.
                              </p>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-slate-800 text-xs">Reference type</Label>
                              <select
                                value={alternateReferenceIdType}
                                onChange={(e) =>
                                  setAlternateReferenceIdType(
                                    e.target.value as "pan" | "bank_account_masked" | "other"
                                  )
                                }
                                className="border border-black px-3 py-2 text-xs font-bold bg-white w-full max-w-xs"
                              >
                                <option value="pan">PAN</option>
                                <option value="bank_account_masked">Masked bank / account ref</option>
                                <option value="other">Other</option>
                              </select>
                            </div>
                            <div className="flex flex-wrap gap-4 text-[11px] font-bold text-slate-800">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={hasUpiHint}
                                  onChange={(e) => setHasUpiHint(e.target.checked)}
                                />
                                Regular UPI / digital payments (hint only)
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={hasUtilityHint}
                                  onChange={(e) => setHasUtilityHint(e.target.checked)}
                                />
                                Regular utility payments (hint only)
                              </label>
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-bold pt-3">
                            <input type="checkbox" checked={quickApplyUnbanked} onChange={(e) => setQuickApplyUnbanked(e.target.checked)} />
                            Quick Apply (minimal inputs)
                          </label>
                          <p className="text-[10px] font-black uppercase tracking-wide text-amber-900 pt-1">
                            Optional — self-upload CSV (unverified)
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                            <select
                              value={alternateSourceType}
                              onChange={(e) => {
                                setAlternateSourceType(e.target.value as "upi" | "utility");
                                setAlternateIngestionSuccess(false);
                                setAlternateIngestionMessage(null);
                              }}
                              className="border border-black px-3 py-2 text-xs font-bold uppercase tracking-wide bg-white"
                            >
                              <option value="upi">UPI / Transaction CSV</option>
                              <option value="utility">Utility payment CSV</option>
                            </select>
                            <input
                              type="file"
                              accept=".csv,text/csv"
                              onChange={(e) => {
                                setAlternateDataFile(e.target.files?.[0] || null);
                                setAlternateIngestionSuccess(false);
                                setAlternateIngestionMessage(null);
                              }}
                              className="border border-black px-3 py-2 text-xs font-bold bg-white"
                            />
                            <button
                              type="button"
                              onClick={handleAlternateDataUpload}
                              disabled={alternateIngestionLoading}
                              className="border border-black px-3 py-2 text-xs font-black uppercase tracking-wide bg-black text-white disabled:opacity-60"
                            >
                              {alternateIngestionLoading ? "Ingesting..." : "Ingest Data"}
                            </button>
                          </div>
                          {alternateIngestionMessage && (
                            <p
                              className={`text-[11px] font-bold pt-1 ${
                                alternateIngestionSuccess ? "text-green-800" : "text-amber-900"
                              }`}
                            >
                              {alternateIngestionMessage}
                            </p>
                          )}

                          {quickApplyUnbanked ? (
                            <>
                              {alternateIngestionSuccess && alternateSourceType === "upi" && (
                                <div className="mt-3 rounded border border-slate-200 bg-white p-3 text-xs space-y-2">
                                  <p className="font-black text-slate-800 uppercase tracking-wide text-[10px]">From your CSV (estimated averages)</p>
                                  <ul className="text-slate-700 space-y-1 font-medium">
                                    <li>Monthly inflow: ₹{formatInrDisplay(upiMonthlyInflow)}</li>
                                    {Number(String(upiMonthlyOutflow).replace(/,/g, "")) > 0 && (
                                      <li>Monthly outflow: ₹{formatInrDisplay(upiMonthlyOutflow)}</li>
                                    )}
                                    {avgMonthlyTransactionCount ? (
                                      <li>Avg transactions / month: {avgMonthlyTransactionCount}</li>
                                    ) : null}
                                    {transactionRegularity ? (
                                      <li>Regularity index: {transactionRegularity}</li>
                                    ) : null}
                                    {monthsUpiHistory ? <li>Months of history in file: {monthsUpiHistory}</li> : null}
                                  </ul>
                                  <button
                                    type="button"
                                    onClick={() => setShowIngestedOverride((v) => !v)}
                                    className="text-[10px] font-black uppercase tracking-wider text-blue-700 underline decoration-dotted"
                                  >
                                    {showIngestedOverride ? "Hide manual override" : "Edit ingested figures"}
                                  </button>
                                  {showIngestedOverride && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-slate-600">UPI monthly inflow (₹)</Label>
                                        <Input
                                          type="number"
                                          min={0}
                                          value={upiMonthlyInflow}
                                          onChange={(e) => setUpiMonthlyInflow(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-slate-600">UPI monthly outflow (₹)</Label>
                                        <Input
                                          type="number"
                                          min={0}
                                          value={upiMonthlyOutflow}
                                          onChange={(e) => setUpiMonthlyOutflow(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-slate-600">Avg monthly tx count</Label>
                                        <Input
                                          type="number"
                                          min={0}
                                          value={avgMonthlyTransactionCount}
                                          onChange={(e) => setAvgMonthlyTransactionCount(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-slate-600">Txn regularity (0–1)</Label>
                                        <Input
                                          value={transactionRegularity}
                                          onChange={(e) => setTransactionRegularity(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                      <div className="space-y-1 sm:col-span-2">
                                        <Label className="text-[10px] text-slate-600">Months UPI history</Label>
                                        <Input
                                          type="number"
                                          min={0}
                                          value={monthsUpiHistory}
                                          onChange={(e) => setMonthsUpiHistory(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {alternateIngestionSuccess && alternateSourceType === "utility" && (
                                <div className="mt-3 rounded border border-slate-200 bg-white p-3 text-xs space-y-2">
                                  <p className="font-black text-slate-800 uppercase tracking-wide text-[10px]">From your CSV (utility)</p>
                                  <ul className="text-slate-700 space-y-1 font-medium">
                                    <li>Payment regularity: {utilityPaymentRegularity || "—"}</li>
                                    <li>Months of history in file: {monthsUtilityHistory || "—"}</li>
                                  </ul>
                                  <button
                                    type="button"
                                    onClick={() => setShowIngestedOverride((v) => !v)}
                                    className="text-[10px] font-black uppercase tracking-wider text-blue-700 underline decoration-dotted"
                                  >
                                    {showIngestedOverride ? "Hide manual override" : "Edit ingested figures"}
                                  </button>
                                  {showIngestedOverride && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-slate-600">Utility regularity (0–1)</Label>
                                        <Input
                                          value={utilityPaymentRegularity}
                                          onChange={(e) => setUtilityPaymentRegularity(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-slate-600">Months utility history</Label>
                                        <Input
                                          type="number"
                                          min={0}
                                          value={monthsUtilityHistory}
                                          onChange={(e) => setMonthsUtilityHistory(e.target.value)}
                                          className="bg-white text-xs h-8"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {!alternateIngestionSuccess && (
                                <div className="mt-3 space-y-2 rounded border border-amber-200 bg-amber-50/90 p-3">
                                  <p className="text-[11px] font-bold text-amber-950">
                                    Upload a CSV above to auto-fill signals, or enter how long you have payment history below (at least one
                                    field).
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                      <Label className="text-slate-800 text-xs">Months of UPI / digital payment history</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        placeholder="e.g. 6"
                                        value={monthsUpiHistory}
                                        onChange={(e) => setMonthsUpiHistory(e.target.value)}
                                        className="bg-white border-slate-300 text-slate-900 text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label className="text-slate-800 text-xs">
                                        Months of utility history <span className="text-slate-500 font-normal">(optional)</span>
                                      </Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        placeholder="e.g. 6"
                                        value={monthsUtilityHistory}
                                        onChange={(e) => setMonthsUtilityHistory(e.target.value)}
                                        className="bg-white border-slate-300 text-slate-900 text-xs"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="space-y-3 pt-3 border-t border-blue-100">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Required and profile</p>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">
                                    Declared monthly income (₹) <span className="text-red-500">*</span>
                                  </Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder="What you earn or declare per month"
                                    value={declaredMonthlyIncome}
                                    onChange={(e) => setDeclaredMonthlyIncome(e.target.value)}
                                    className="bg-white border-slate-300 text-slate-900"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">
                                    Employment / business type <span className="text-slate-400 font-normal">(optional)</span>
                                  </Label>
                                  <Input
                                    placeholder="e.g. retail, gig, agriculture"
                                    value={employmentOrBusinessType}
                                    onChange={(e) => setEmploymentOrBusinessType(e.target.value)}
                                    className="bg-white border-slate-300 text-slate-900"
                                  />
                                </div>
                                {alternateIngestionSuccess && alternateSourceType === "upi" && (
                                  <div className="space-y-1.5">
                                    <Label className="text-slate-700 text-xs">
                                      Extra utility history (months) <span className="text-slate-400 font-normal">(optional)</span>
                                    </Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      placeholder="If you also have bill payment history"
                                      value={monthsUtilityHistory}
                                      onChange={(e) => setMonthsUtilityHistory(e.target.value)}
                                      className="bg-white border-slate-300 text-slate-900 text-xs"
                                    />
                                  </div>
                                )}
                                {alternateIngestionSuccess && alternateSourceType === "utility" && (
                                  <div className="space-y-1.5">
                                    <Label className="text-slate-700 text-xs">
                                      UPI / digital history (months) <span className="text-slate-400 font-normal">(optional)</span>
                                    </Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      placeholder="If you also have UPI data not in this CSV"
                                      value={monthsUpiHistory}
                                      onChange={(e) => setMonthsUpiHistory(e.target.value)}
                                      className="bg-white border-slate-300 text-slate-900 text-xs"
                                    />
                                  </div>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="space-y-3 pt-2">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">UPI monthly inflow (₹)</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={upiMonthlyInflow}
                                    onChange={(e) => setUpiMonthlyInflow(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">
                                    UPI monthly outflow (₹) <span className="text-red-500">*</span>
                                  </Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={upiMonthlyOutflow}
                                    onChange={(e) => setUpiMonthlyOutflow(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">
                                    Avg monthly tx count <span className="text-red-500">*</span>
                                  </Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={avgMonthlyTransactionCount}
                                    onChange={(e) => setAvgMonthlyTransactionCount(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">
                                    Txn regularity (0–1) <span className="text-red-500">*</span>
                                  </Label>
                                  <Input
                                    value={transactionRegularity}
                                    onChange={(e) => setTransactionRegularity(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">
                                    Declared monthly income (₹) <span className="text-red-500">*</span>
                                  </Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={declaredMonthlyIncome}
                                    onChange={(e) => setDeclaredMonthlyIncome(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">Employment / business type</Label>
                                  <Input
                                    value={employmentOrBusinessType}
                                    onChange={(e) => setEmploymentOrBusinessType(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">Months UPI history</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={monthsUpiHistory}
                                    onChange={(e) => setMonthsUpiHistory(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-slate-700 text-xs">Months utility history</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={monthsUtilityHistory}
                                    onChange={(e) => setMonthsUtilityHistory(e.target.value)}
                                    className="bg-white text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => setShowAdvancedUnbanked((prev) => !prev)}
                            className="text-[11px] font-black uppercase tracking-wider text-blue-700 pt-2"
                          >
                            {showAdvancedUnbanked ? "Hide advanced details" : "Add advanced details (optional)"}
                          </button>
                          {showAdvancedUnbanked && (
                            <div className="grid grid-cols-2 gap-3 pt-2">
                              <Input placeholder="UPI inflow variance (0-2)" value={upiInflowVariance} onChange={(e) => setUpiInflowVariance(e.target.value)} />
                              <Input placeholder="GST consistency 0-1" value={gstConsistency} onChange={(e) => setGstConsistency(e.target.value)} />
                              <Input placeholder="Utility regularity 0-1" value={utilityPaymentRegularity} onChange={(e) => setUtilityPaymentRegularity(e.target.value)} />
                              <Input placeholder="Rent consistency 0-1" value={rentPaymentConsistency} onChange={(e) => setRentPaymentConsistency(e.target.value)} />
                              <Input placeholder="Months GST history" value={monthsGstHistory} onChange={(e) => setMonthsGstHistory(e.target.value)} />
                              <Input placeholder="Months rent history" value={monthsRentHistory} onChange={(e) => setMonthsRentHistory(e.target.value)} />
                            </div>
                          )}
                          <label className="flex items-center gap-2 text-xs font-bold pt-2">
                            <input type="checkbox" checked={alternateDataConsent} onChange={(e) => setAlternateDataConsent(e.target.checked)} />
                            I consent to alternate data usage for underwriting
                          </label>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Number of Dependents</Label>
                          <Select value={dependents} onValueChange={setDependents}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900">
                              <SelectValue placeholder="0" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="0">0</SelectItem>
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3+">3 or more</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Existing Loans</Label>
                          <Select value={hasExistingLoan} onValueChange={setHasExistingLoan}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="no">No</SelectItem>
                              <SelectItem value="yes">Yes</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {hasExistingLoan === "yes" && (
                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                          <Label className="text-slate-900 text-xs">Total Current EMI (₹/month)</Label>
                          <Input
                            type="number"
                            placeholder="e.g. 5000"
                            value={existingEmi}
                            onChange={e => setExistingEmi(e.target.value)}
                            className="bg-white border-slate-300 text-slate-900"
                          />
                        </div>
                      )}

                      <div className="space-y-3 pt-2">
                        <Label className="text-slate-600 text-xs">Do you have a Co-applicant / Guarantor?</Label>
                        <RadioGroup value={coApplicant} onValueChange={setCoApplicant} className="flex gap-4">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="none" id="r1" className="border-slate-400 text-blue-600" />
                            <Label htmlFor="r1" className="text-slate-900 font-normal cursor-pointer">No</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="coapplicant" id="r2" className="border-slate-400 text-blue-600" />
                            <Label htmlFor="r2" className="text-slate-900 font-normal cursor-pointer">Yes (Co-applicant)</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="guarantor" id="r3" className="border-slate-400 text-blue-600" />
                            <Label htmlFor="r3" className="text-slate-900 font-normal cursor-pointer">Yes (Guarantor)</Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {coApplicant !== "none" && (
                        <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-slate-600 text-xs">Their Full Name</Label>
                              <Input className="bg-white border-slate-300 text-slate-900" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-slate-600 text-xs">Relationship</Label>
                              <Select>
                                <SelectTrigger className="bg-white border-slate-300 text-slate-900">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-300 text-slate-900">
                                  <SelectItem value="spouse">Spouse</SelectItem>
                                  <SelectItem value="parent">Parent</SelectItem>
                                  <SelectItem value="sibling">Sibling</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="grid sm:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-slate-600 text-xs">Monthly Income (₹)</Label>
                              <Input type="number" placeholder="50000" className="bg-white border-slate-300 text-slate-900" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-slate-600 text-xs">Employment Type</Label>
                              <Select>
                                <SelectTrigger className="bg-white border-slate-300 text-slate-900">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-300 text-slate-900">
                                  <SelectItem value="salaried">Salaried</SelectItem>
                                  <SelectItem value="self">Self-employed</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-slate-600 text-xs">PAN Number</Label>
                              <Input placeholder="ABCDE1234F" className="bg-white border-slate-300 text-slate-900 uppercase" />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="space-y-4 pt-4 border-t border-slate-200">
                        <h3 className="text-sm font-medium text-slate-700">Identity Verification</h3>
                        <p className="text-xs text-slate-500">Please provide a quick face scan to securely verify your identity.</p>

                        <div className="grid sm:grid-cols-2 gap-4">
                          <Card onClick={() => startCamera("applicant")} className={`bg-blue-50 border-dashed ${faceScanImage ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors cursor-pointer group h-full`}>
                            <CardContent className="p-4 flex flex-col items-center justify-center gap-2 text-center h-full relative overflow-hidden">
                              {faceScanImage ? (
                                <>
                                  <img src={faceScanImage} alt="Face Scan" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                                  <div className="relative z-10 w-12 h-12 rounded-full bg-blue-200 border border-blue-600 flex items-center justify-center">
                                    <CheckCircle2 className="w-6 h-6 text-blue-600" />
                                  </div>
                                  <h4 className="relative z-10 text-sm font-medium text-slate-900 shadow-white drop-shadow-md">Verified</h4>
                                </>
                              ) : (
                                <>
                                  <div className="w-12 h-12 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center group-hover:scale-105 transition-all">
                                    <Camera className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-medium text-slate-900">Your Face Scan</h4>
                                    <p className="text-xs text-slate-500">Tap to open camera</p>
                                  </div>
                                </>
                              )}
                            </CardContent>
                          </Card>

                          {coApplicant !== "none" && (
                            <Card onClick={() => startCamera("coApplicant")} className={`bg-blue-50 border-dashed ${coAppFaceScanImage ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors cursor-pointer group h-full`}>
                              <CardContent className="p-4 flex flex-col items-center justify-center gap-2 text-center h-full relative overflow-hidden">
                                {coAppFaceScanImage ? (
                                  <>
                                    <img src={coAppFaceScanImage} alt="Co-App Face Scan" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                                    <div className="relative z-10 w-12 h-12 rounded-full bg-blue-200 border border-blue-600 flex items-center justify-center">
                                      <CheckCircle2 className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <h4 className="relative z-10 text-sm font-medium text-slate-900 capitalize shadow-black drop-shadow-md">{coApplicant} Verified</h4>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-12 h-12 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center group-hover:scale-105 transition-all">
                                      <Camera className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-medium text-slate-900 capitalize">{coApplicant} Face Scan</h4>
                                      <p className="text-xs text-slate-500">Tap to open camera</p>
                                    </div>
                                  </>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {stepError && (
                  <div className="bg-red-50 border-[1.5px] border-black p-4 flex items-start gap-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] mb-6 animate-in fade-in slide-in-from-bottom-2">
                    <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-black text-red-600 uppercase tracking-widest">Missing Details</h4>
                      <p className="text-xs font-bold text-red-700 mt-1 uppercase tracking-wide leading-relaxed">PLEASE COMPLETE: {stepError}</p>
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button type="button" variant="outline" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3">BACK</Button>
                  <Button type="submit" className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-6 py-3 transition-all">CONTINUE &rarr;</Button>
                </div>
              </div>

              {/* Side Info Panel */}
              <div className="space-y-4">
                <Card className="bg-white border-[1.5px] border-black rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                  <CardHeader className="pb-3 border-b-[1.5px] border-black bg-blue-50/50">
                    <CardTitle className="text-sm font-black text-black uppercase tracking-widest flex items-center gap-2">
                      <InfoIcon className="w-5 h-5 text-blue-600" /> WHY DO WE NEED THIS?
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 text-xs font-bold text-slate-800 space-y-4 leading-relaxed tracking-wide uppercase">
                    <p className="flex gap-2"><span className="text-blue-600 font-black">•</span> PROVIDE ACCURATE DETAILS FOR BETTER ASSESSMENT AND QUICKER APPROVAL.</p>
                    <p className="flex gap-2"><span className="text-blue-600 font-black">•</span> WE ACCEPT SELF-DECLARED INCOME. NO STRICT DOCUMENTATION NEEDED RIGHT NOW.</p>
                    <p className="flex gap-2"><span className="text-blue-600 font-black">•</span> INCLUDING A CO-APPLICANT CAN INCREASE YOUR ELIGIBILITY LIMIT SIGNIFICANTLY.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </form>
        )}

        {/* STEP 2: Loan Details + EMI + Occupation */}
        {step === 2 && loanType !== 'education' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-300">
            <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase">LOAN CONFIGURATION</h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <Card className="bg-white border-slate-300">
                  <CardContent className="p-6 space-y-8">

                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <Label className="text-slate-600 text-sm">Desired Loan Amount <span className="text-red-500">*</span></Label>
                        <div className="bg-slate-50 border border-slate-300 rounded-md px-3 py-1 flex items-center gap-2">
                          <span className="text-slate-600">₹</span>
                          <Input
                            type="number"
                            className="bg-transparent border-0 h-8 w-32 text-right text-lg font-bold text-slate-900 focus-visible:ring-0 p-0"
                            value={loanAmount[0]}
                            onChange={(e) => setLoanAmount([Number(e.target.value)])}
                          />
                        </div>
                      </div>
                      <Slider
                        max={loanConfig.max}
                        min={loanConfig.min}
                        step={loanConfig.step}
                        value={loanAmount}
                        onValueChange={setLoanAmount}
                        className="py-4"
                      />
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>{loanConfig.minLabel}</span>
                        <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-medium">{loanConfig.recLabel}</span>
                        <span>{loanConfig.maxLabel}</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-slate-600 text-sm">Tenure (Months) <span className="text-red-500">*</span></Label>
                      <Select value={tenure} onValueChange={setTenure}>
                        <SelectTrigger className="bg-white border-slate-300 text-slate-900 font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-300 text-slate-900">
                          <SelectItem value="6">6 Months</SelectItem>
                          <SelectItem value="12">12 Months (1 Year)</SelectItem>
                          <SelectItem value="24">24 Months (2 Years)</SelectItem>
                          <SelectItem value="36">36 Months (3 Years)</SelectItem>
                          <SelectItem value="60">60 Months (5 Years)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-600 italic mt-1 flex items-center gap-1.5">
                        <InfoIcon className="w-3.5 h-3.5" /> Higher tenure reduces EMI but increases total interest paid.
                      </p>
                    </div>

                    {loanType === 'business' ? (
                      <div className="space-y-4 pt-4 border-t border-slate-300 animate-in fade-in">
                        <Label className="text-slate-600 text-sm">Business Enterprise Type <span className="text-red-500">*</span></Label>
                        <div className="grid grid-cols-2 gap-3">
                          <div
                            onClick={() => setBusinessType("msme")}
                            className={`border rounded-lg p-3 text-center cursor-pointer transition-all text-sm font-medium
                              ${businessType === 'msme'
                                ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-[0_0_10px_rgba(37,99,235,0.15)]'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                          >
                            Micro, Small & Medium Enterprise (MSME)
                          </div>
                          <div
                            onClick={() => setBusinessType("large")}
                            className={`border rounded-lg p-3 text-center cursor-pointer transition-all text-sm font-medium
                              ${businessType === 'large'
                                ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-[0_0_10px_rgba(37,99,235,0.15)]'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                          >
                            Large Enterprise
                          </div>
                        </div>

                        {businessType === 'msme' && (
                          <div className="space-y-3 pt-4 border-t border-slate-300 animate-in fade-in slide-in-from-top-2">
                            <Label className="text-slate-900 font-medium">MSME Certificate / Udyam Registration</Label>
                            <label className="block w-full cursor-pointer relative mt-2">
                              <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => setMsmeCertificate(e.target.files?.[0] || null)} />
                              <div className={`border border-dashed ${msmeCertificate ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-slate-50'} px-4 py-3 rounded-lg flex items-center gap-3 hover:bg-slate-100 transition-colors`}>
                                <FileText className={`w-5 h-5 ${msmeCertificate ? 'text-blue-600' : 'text-slate-600'}`} />
                                <span className="text-sm text-slate-700 z-10 relative pointer-events-none line-clamp-1">{msmeCertificate ? msmeCertificate.name : 'Upload Certificate PDF/JPG'}</span>
                                {msmeCertificate && <CheckCircle2 className="w-4 h-4 text-blue-600 ml-auto" />}
                              </div>
                            </label>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4 pt-4 border-t border-slate-300 animate-in fade-in">
                        <Label className="text-slate-600 text-sm">Occupation Status <span className="text-red-500">*</span></Label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {occupations.map(occ => (
                            <div
                              key={occ}
                              onClick={() => setOccupation(occ)}
                              className={`border rounded-lg p-3 text-center cursor-pointer transition-all text-xs font-medium
                                ${occupation === occ
                                  ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-[0_0_10px_rgba(37,99,235,0.15)]'
                                  : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                            >
                              {occ}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </CardContent>
                </Card>

                {stepError && (
                  <div className="bg-red-50 border-[1.5px] border-black p-4 flex items-start gap-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] mb-6 animate-in fade-in slide-in-from-bottom-2">
                    <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-black text-red-600 uppercase tracking-widest">Missing Details</h4>
                      <p className="text-xs font-bold text-red-700 mt-1 uppercase tracking-wide leading-relaxed">PLEASE COMPLETE: {stepError}</p>
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3">BACK</Button>
                  <Button onClick={nextStep} className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-6 py-3 transition-all">CONTINUE &rarr;</Button>
                </div>
              </div>

              {/* EMI Calculator Panel */}
              <div className="space-y-4 relative">
                <div className="sticky top-[88px]">
                  <Card className="bg-white border-[1.5px] border-black rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                    <CardHeader className="pb-4 border-b-[1.5px] border-black bg-slate-50">
                      <CardTitle className="text-lg font-black text-black uppercase tracking-widest">EMI Estimate</CardTitle>
                      <CardDescription className="text-xs font-bold text-slate-500 uppercase tracking-widest">Calculated at ~14.0% p.a.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">

                      <div className="text-center pb-6 border-b-[1.5px] border-black">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Monthly EMI</p>
                        <p className="text-5xl font-black text-black tracking-tighter">₹{Math.round(emi).toLocaleString('en-IN')}</p>

                        <div className={`mt-4 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 border-[1.5px] border-black uppercase tracking-wider ${getEmiRisk().bg} ${getEmiRisk().color}`}>
                          <div className={`w-2 h-2 bg-current`}></div>
                          {getEmiRisk().text} RISK
                        </div>
                      </div>

                      <div className="space-y-4 text-sm font-bold uppercase tracking-wider text-slate-800">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">Principal Amount</span>
                          <span className="text-black text-base">₹{loanAmount[0].toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">Total Interest</span>
                          <span className="text-black text-base">₹{Math.round(totalInterest).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between items-center text-black pt-4 border-t-[1.5px] border-black">
                          <span>Total Payable</span>
                          <span className="text-blue-600 text-lg">₹{Math.round(totalPayable).toLocaleString('en-IN')}</span>
                        </div>
                      </div>

                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Loan specific details & Occupation specific questions */}
        {step === 3 && loanType !== 'education' && (
          <form onSubmit={(e) => { e.preventDefault(); nextStep(); }} className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-300">
            <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase">ADDITIONAL DETAILS</h2>
            <p className="text-xs font-bold text-black/40 uppercase tracking-[0.2em] mt-[-16px]">Based on your selection, we need a few more particulars.</p>

            <Card className="bg-white border-slate-300">
              <CardContent className="p-6 space-y-8">

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 flex items-start gap-2 mb-6">
                  <InfoIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>You can enter <strong>approximate values</strong> if exact data is not available. Please briefly describe your loan purpose below.</p>
                </div>

                {/* Section A: Purpose */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-2 tracking-wide uppercase">
                    Loan Purpose
                  </h3>
                  <div className="space-y-2 mb-8">
                    <Label className="text-slate-700 text-xs font-medium">Please briefly describe the purpose of your loan</Label>
                    <Input placeholder="e.g. Home renovation, medical emergency, wedding..." className="bg-white border-slate-300 text-slate-900 p-3 h-12" />
                  </div>
                </div>

                {/* Section B: Occupation Specific */}
                {occupation ? (
                  <div className="space-y-4 pt-6 mt-8 border-t-[1.5px] border-black border-dashed">
                    <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-2 tracking-wide uppercase mb-4">
                      <Briefcase className="w-4 h-4" />
                      {occupation === 'Salaried' ? 'Employment Details' :
                        occupation === 'Self-employed' ? 'Business Details' :
                          occupation === 'Gig Worker' ? 'Platform Work Details' :
                            ['Homemaker', 'Student', 'Unemployed'].includes(occupation) ? 'Financial Support Details' :
                              occupation === 'Farmer' ? 'Agricultural Details' :
                                occupation === 'Retired' ? 'Income Details' : 'Details'}
                    </h3>


                    <div className="grid sm:grid-cols-2 gap-5">
                      {/* DYNAMIC FIELDS based on Occupation */}

                      {occupation === 'Salaried' && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Company Name</Label>
                            <Input placeholder="e.g. TCS, Infosys" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Employment Type</Label>
                            <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="perm">Permanent</SelectItem><SelectItem value="contract">Contract</SelectItem><SelectItem value="temp">Temporary</SelectItem></SelectContent></Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Years in Current Job</Label>
                            <Input type="number" placeholder="e.g. 3" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Total Work Experience (Optional)</Label>
                            <Input type="number" placeholder="e.g. 8" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                        </>
                      )}

                      {(occupation === 'Self-employed' || loanType === 'business') && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Type of Business</Label>
                            <Input placeholder="e.g. Retail Shop, Freelance IT" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Business Age (Years)</Label>
                            <Input type="number" placeholder="e.g. 5" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Average Monthly Revenue</Label>
                            <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select Range" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="<50k">Below ₹50,000</SelectItem><SelectItem value="50k-2L">₹50K - ₹2L</SelectItem><SelectItem value=">2L">Above ₹2L</SelectItem></SelectContent></Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Average Monthly Profit (Optional)</Label>
                            <Input placeholder="approximate exact value" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Income Consistency</Label>
                            <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="high">High (Predictable)</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low (Highly Variable)</SelectItem></SelectContent></Select>
                          </div>
                        </>
                      )}

                      {occupation === 'Gig Worker' && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Platform Name</Label>
                            <Input placeholder="e.g. Uber, Swiggy, Urban Company" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Duration of Work (Months)</Label>
                            <Input type="number" placeholder="e.g. 14" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Average Monthly Income</Label>
                            <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select Range" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="<15k">Below ₹15,000</SelectItem><SelectItem value="15k-30k">₹15K - ₹30K</SelectItem><SelectItem value=">30k">Above ₹30K</SelectItem></SelectContent></Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Weekly Working Hours</Label>
                            <Input type="number" placeholder="e.g. 40" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs font-medium">Income Consistency</Label>
                            <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
                          </div>
                        </>
                      )}

                      {['Homemaker', 'Student', 'Unemployed'].includes(occupation) && (
                        <div className="col-span-1 sm:col-span-2 space-y-6">
                          <div className="space-y-3">
                            <Label className="text-slate-900">Do you have a co-applicant or guarantor?</Label>
                            <RadioGroup defaultValue="yes" onValueChange={setCoApplicant} className="flex gap-6">
                              <div className="flex items-center space-x-2"><RadioGroupItem value="yes" id="co-yes" className="border-slate-400 text-blue-600" /><Label htmlFor="co-yes" className="text-slate-700">Yes</Label></div>
                              <div className="flex items-center space-x-2"><RadioGroupItem value="no" id="co-no" className="border-slate-400 text-blue-600" /><Label htmlFor="co-no" className="text-slate-700">No</Label></div>
                            </RadioGroup>
                          </div>

                          {coApplicant === 'yes' ? (
                            <div className="grid sm:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                              <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Co-applicant Name</Label><Input placeholder="Name" className="bg-white border-slate-300 text-slate-900" /></div>
                              <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Relationship</Label><Input placeholder="e.g. Spouse, Parent" className="bg-white border-slate-300 text-slate-900" /></div>
                              <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Co-applicant Income Range</Label>
                                <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select Range" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="<25k">Below ₹25,000</SelectItem><SelectItem value="25-50k">₹25,000 - ₹50,000</SelectItem><SelectItem value=">50k">Above ₹50,000</SelectItem></SelectContent></Select>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                              <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-amber-700 text-sm flex gap-2">
                                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                <p>Adding a co-applicant significantly increases your approval chances.</p>
                              </div>
                              <div className="space-y-3">
                                <Label className="text-slate-900">Do you own any physical or financial assets?</Label>
                                <RadioGroup defaultValue="no" className="flex gap-6">
                                  <div className="flex items-center space-x-2"><RadioGroupItem value="yes" id="ast-yes" className="border-slate-400 text-blue-600" /><Label htmlFor="ast-yes" className="text-slate-700">Yes</Label></div>
                                  <div className="flex items-center space-x-2"><RadioGroupItem value="no" id="ast-no" className="border-slate-400 text-blue-600" /><Label htmlFor="ast-no" className="text-slate-700">No</Label></div>
                                </RadioGroup>
                              </div>
                              <div className="grid sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Asset Type</Label><Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="gold">Gold</SelectItem><SelectItem value="property">Property</SelectItem><SelectItem value="savings">Savings / FDs</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                                <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Estimated Asset Value</Label><Input placeholder="₹" className="bg-white border-slate-300 text-slate-900" /></div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {occupation === 'Farmer' && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Land Ownership</Label>
                            <Select><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="owned">Owned</SelectItem><SelectItem value="leased">Leased</SelectItem></SelectContent></Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Total Land Area (Acres)</Label>
                            <Input type="number" step="0.1" placeholder="e.g. 5.5" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Primary Crop Type</Label>
                            <Input placeholder="e.g. Wheat, Rice, Sugarcane" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Estimated Seasonal Income</Label>
                            <Input placeholder="₹" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-slate-600 text-xs">Other Income Sources (Optional)</Label>
                            <Input placeholder="e.g. Dairy, Poultry, Labour" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                        </>
                      )}

                      {occupation === 'Retired' && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Monthly Pension Amount</Label>
                            <Input placeholder="₹" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Other Income Sources (Optional)</Label>
                            <Input placeholder="e.g. Rent, Fixed Deposits" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Number of Dependents</Label>
                            <Input type="number" placeholder="e.g. 1" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-slate-600 text-xs">Average Monthly Expenses</Label>
                            <Input placeholder="₹" className="bg-white border-slate-300 text-slate-900" />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                {loanType === 'home' && (
                  <div className="space-y-4 pt-6 border-t border-slate-200">
                    <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-2 tracking-wide uppercase mb-4">
                      <Home className="w-4 h-4" /> Property Details <span className="text-red-500">*</span>
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Property Location / City <span className="text-red-500">*</span></Label>
                        <Input placeholder="e.g. Mumbai, Maharashtra" value={homeLocation} onChange={e => setHomeLocation(e.target.value)} className="bg-white border-slate-300 text-slate-900" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Configuration (BHK) <span className="text-red-500">*</span></Label>
                        <Select value={bhk} onValueChange={setBhk}><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="1">1 BHK</SelectItem><SelectItem value="2">2 BHK</SelectItem><SelectItem value="3">3 BHK</SelectItem><SelectItem value="4+">4+ BHK</SelectItem><SelectItem value="plot">Plot / Land</SelectItem></SelectContent></Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Carpet Area (Sq. Ft.) <span className="text-red-500">*</span></Label>
                        <Input type="number" placeholder="e.g. 1200" value={homeArea} onChange={e => setHomeArea(e.target.value)} className="bg-white border-slate-300 text-slate-900" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Estimated Price / Valuation <span className="text-red-500">*</span></Label>
                        <Input placeholder="₹" value={estimatedPrice} onChange={e => setEstimatedPrice(e.target.value)} className="bg-white border-slate-300 text-slate-900" required />
                      </div>
                    </div>
                  </div>
                )}

                {loanType === 'auto' && (
                  <div className="space-y-4 pt-6 border-t border-slate-200">
                    <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-2 tracking-wide uppercase mb-4">
                      <Car className="w-4 h-4" /> Automobile Details <span className="text-red-500">*</span>
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Automobile Type <span className="text-red-500">*</span></Label>
                        <Select value={autoType} onValueChange={setAutoType}><SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-white border-slate-300 text-slate-900"><SelectItem value="car">Car</SelectItem><SelectItem value="two_wheeler">Two Wheeler</SelectItem><SelectItem value="commercial">Commercial</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Model & Brand <span className="text-red-500">*</span></Label>
                        <Input placeholder="e.g. Honda City ZX" value={autoModel} onChange={e => setAutoModel(e.target.value)} className="bg-white border-slate-300 text-slate-900" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Estimated Price / On-road Cost <span className="text-red-500">*</span></Label>
                        <Input placeholder="₹" value={autoPrice} onChange={e => setAutoPrice(e.target.value)} className="bg-white border-slate-300 text-slate-900" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Variant & Additional Info</Label>
                        <Input placeholder="e.g. Petrol, Manual, 2024 Model" value={autoDetails} onChange={e => setAutoDetails(e.target.value)} className="bg-white border-slate-300 text-slate-900" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Section C: Optional Documents Upload */}
                <div className="pt-6 border-t border-slate-200 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-2 tracking-wide uppercase">
                      Optional Documents
                    </h3>
                    <p className="text-xs text-slate-600 mt-1">Uploading documents improves your approval chances and speeds up processing.</p>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Render specific docs based on occupation */}

                    {/* Universal Aadhaar / PAN — OCR verified (images only, Textract AnalyzeID doesn't support PDF) */}
                    <label className="block w-full cursor-pointer relative">
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => handleIdentityFileChange(e.target.files?.[0] || null)} />
                      <Card className={`bg-white border-dashed ${identityFile ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors group h-full`}>
                        <CardContent className="p-4 flex items-center gap-4 h-full relative z-0 overflow-hidden">
                          {identityFile && <div className="absolute inset-0 bg-blue-50 pointer-events-none" />}
                          <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${identityFile ? 'bg-blue-100' : 'bg-slate-100 group-hover:bg-blue-100'}`}>
                            {ocrResult?.identityVerified ? <CheckCircle2 className="w-5 h-5 text-blue-600" /> : <Shield className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />}
                          </div>
                          <div className="relative z-10 flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-slate-900 mb-0.5">Aadhaar / PAN Card</h4>
                            {!identityFile && <p className="text-xs text-slate-500">JPG or PNG · auto-verified</p>}
                            {identityFile && !ocrLoading && !ocrResult && !ocrError && <p className="text-xs text-slate-600 truncate">{identityFile.name}</p>}
                            {ocrLoading && <p className="text-xs text-blue-500 mt-0.5">Analysing document…</p>}
                            {ocrResult?.identityVerified && <p className="text-xs text-green-600 mt-0.5">✓ Verified{ocrResult.name ? ` · ${ocrResult.name}` : ''}{ocrResult.idNumber ? ` · ${ocrResult.idNumber}` : ''}</p>}
                            {ocrResult && !ocrResult.identityVerified && !ocrError && <p className="text-xs text-amber-600 mt-0.5">⚠ Could not verify — check image clarity</p>}
                            {ocrError && <p className="text-xs text-amber-600 mt-0.5">⚠ {ocrError}</p>}
                          </div>
                        </CardContent>
                      </Card>
                    </label>

                    {/* Universal Bank Statement Upload */}
                    <label className="block w-full cursor-pointer relative">
                      <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => setFinancialFile(e.target.files?.[0] || null)} />
                      <Card className={`bg-white border-dashed ${financialFile ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors group h-full`}>
                        <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                          {financialFile && <div className="absolute inset-0 bg-blue-50 pointer-events-none" />}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${financialFile ? 'bg-blue-100' : 'bg-slate-100 group-hover:bg-blue-100'}`}>
                            {financialFile ? <CheckCircle2 className="w-5 h-5 text-blue-600" /> : <FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />}
                          </div>
                          <div className="flex-1">
                            <h4 className="text-sm font-medium text-slate-900 mb-0.5">Bank Statement</h4>
                            <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">{financialFile ? financialFile.name : 'Last 3-6 months'}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </label>

                    {/* Salaried Docs */}
                    {occupation === 'Salaried' && (
                      <>
                        <label className="block w-full cursor-pointer relative">
                          <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                          <Card className="bg-white border-dashed border-slate-300 hover:border-blue-600 transition-colors group h-full">
                            <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                                <Briefcase className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                              </div>
                              <div className="flex-1">
                                <h4 className="text-sm font-medium text-slate-900 mb-0.5">Salary Slips</h4>
                                <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">Last 3 months</p>
                              </div>
                            </CardContent>
                          </Card>
                        </label>
                      </>
                    )}

                    {/* Self Employed / Business Docs */}
                    {(occupation === 'Self-employed' || loanType === 'business') && (
                      <label className="block w-full cursor-pointer relative">
                        <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                        <Card className="bg-white border-dashed border-slate-300 hover:border-blue-600 transition-colors group h-full">
                          <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                              <Store className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                            </div>
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-slate-900 mb-0.5">Business Proof</h4>
                              <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">GST/Registration</p>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    )}

                    {/* Gig Worker Docs */}
                    {occupation === 'Gig Worker' && (
                      <label className="block w-full cursor-pointer relative">
                        <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                        <Card className="bg-white border-dashed border-slate-300 hover:border-blue-600 transition-colors group h-full">
                          <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                              <Camera className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                            </div>
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-slate-900 mb-0.5">Platform Setup</h4>
                              <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">Screenshot of app profile</p>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    )}

                    {/* Unemployed/Homemaker/Student Docs */}
                    {['Homemaker', 'Student', 'Unemployed'].includes(occupation) && (
                      <label className="block w-full cursor-pointer relative">
                        <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                        <Card className="bg-white border-dashed border-slate-300 hover:border-blue-600 transition-colors group h-full">
                          <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                              <FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                            </div>
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-slate-900 mb-0.5">{coApplicant === 'yes' ? 'Co-applicant Proof' : 'Asset Proof'}</h4>
                              <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">Income/Ownership proof</p>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    )}

                    {/* Farmer Docs */}
                    {occupation === 'Farmer' && (
                      <label className="block w-full cursor-pointer relative">
                        <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                        <Card className="bg-white border-dashed border-slate-300 hover:border-blue-600 transition-colors group h-full">
                          <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                              <FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                            </div>
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-slate-900 mb-0.5">Land Proof</h4>
                              <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">Khasra/Khatauni or lease</p>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    )}

                    {loanType === 'home' && (
                      <label className="block w-full cursor-pointer relative">
                        <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => setPropertyDocument(e.target.files?.[0] || null)} />
                        <Card className={`bg-white border-dashed ${propertyDocument ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors group h-full`}>
                          <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                              {propertyDocument ? <CheckCircle2 className="w-5 h-5 text-blue-600" /> : <FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600" />}
                            </div>
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-slate-900 mb-0.5">Property Document</h4>
                              <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">{propertyDocument ? propertyDocument.name : 'Agreement or Quote'}</p>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    )}

                    {loanType === 'auto' && (
                      <label className="block w-full cursor-pointer relative">
                        <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => setAutoDocument(e.target.files?.[0] || null)} />
                        <Card className={`bg-white border-dashed ${autoDocument ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors group h-full`}>
                          <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100">
                              {autoDocument ? <CheckCircle2 className="w-5 h-5 text-blue-600" /> : <FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600" />}
                            </div>
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-slate-900 mb-0.5">Vehicle Quote/Doc</h4>
                              <p className="text-xs text-slate-600 z-10 relative pointer-events-none line-clamp-1">{autoDocument ? autoDocument.name : 'Dealership quote'}</p>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    )}
                  </div>

                  {occupation === 'Gig Worker' && (
                    <div className="flex items-start gap-3 mt-4">
                      <input type="checkbox" id="gig-confirm" className="mt-0.5 w-4 h-4 cursor-pointer flex-shrink-0" />
                      <Label htmlFor="gig-confirm" className="text-sm text-slate-700 font-normal cursor-pointer hover:text-slate-900 transition-colors flex-1">
                        OR I confirm that I actively work on this platform
                      </Label>
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6 mb-2 space-y-3">
                    <div className="flex items-start gap-4">
                      <input type="checkbox" id="assets-confirm" checked={assetsConfirmed} onChange={(e) => setAssetsConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5 cursor-pointer flex-shrink-0" />
                      <Label htmlFor="assets-confirm" className="text-sm text-slate-900 font-medium cursor-pointer leading-tight">
                        I confirm that the physical or financial assets provided are correct.
                      </Label>
                    </div>
                    <div className="flex items-start gap-4">
                      <input type="checkbox" id="final-confirm" checked={finalConfirmed} onChange={(e) => setFinalConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5 cursor-pointer flex-shrink-0" />
                      <Label htmlFor="final-confirm" className="text-sm text-slate-900 font-medium cursor-pointer leading-tight">
                        I confirm that the information provided is true to the best of my knowledge and I authorize Barclays to verify these details.
                      </Label>
                    </div>
                  </div>
                </div>

              </CardContent>
            </Card>

            {stepError && (
              <div className="bg-red-50 border-[1.5px] border-black p-4 flex items-start gap-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] mb-6 animate-in fade-in slide-in-from-bottom-2">
                <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-black text-red-600 uppercase tracking-widest">Missing Details</h4>
                  <p className="text-xs font-bold text-red-700 mt-1 uppercase tracking-wide leading-relaxed">PLEASE COMPLETE: {stepError}</p>
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3">BACK</Button>
              <Button type="submit" className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-6 py-3 transition-all">REVIEW APPLICATION &rarr;</Button>
            </div>
          </form>
        )}

        {/* STEP 4: Review & Submit */}
        {step === 4 && loanType !== 'education' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-300 max-w-3xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-2">REVIEW YOUR APPLICATION</h2>
              <p className="text-xs font-bold text-black/40 uppercase tracking-[0.2em]">Please verify the details before final submission.</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="border-[1.5px] border-black bg-white p-6 flex flex-col justify-between h-full relative shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <div className="space-y-1 z-10">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.15em]">Loan Request</span>
                  <h3 className="text-xl font-black text-black uppercase tracking-tighter">{loanOptions.find(o => o.id === loanType)?.title}</h3>
                </div>
                <div className="mt-6 z-10">
                  <p className="text-4xl font-black text-blue-600 tracking-tighter">₹{loanAmount[0].toLocaleString('en-IN')}</p>
                  <p className="text-sm font-bold text-black uppercase tracking-wider mt-1">for {tenure} months</p>
                </div>
              </div>

              <div className="border-[1.5px] border-black bg-slate-50 p-6 flex flex-col justify-between h-full shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <div className="space-y-1">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.15em]">Repayment</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <p className="text-4xl font-black text-black tracking-tighter">₹{Math.round(emi).toLocaleString('en-IN')}</p>
                    <span className="text-sm font-bold text-black/40 uppercase tracking-widest">/MO</span>
                  </div>
                </div>
                <div className={`mt-6 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 border-[1.5px] border-black uppercase tracking-wider ${getEmiRisk().bg} ${getEmiRisk().color} w-fit`}>
                  <div className={`w-2 h-2 bg-current`}></div>
                  {getEmiRisk().text} RISK
                </div>
              </div>

              <div className="sm:col-span-2 border-[1.5px] border-black bg-white p-6 grid grid-cols-2 sm:grid-cols-4 gap-6 divide-y sm:divide-y-0 sm:divide-x-[1.5px] divide-black shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <div className="flex flex-col gap-1 sm:pt-0 pt-0">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Applicant</span>
                  <span className="text-base font-black text-black uppercase tracking-tight truncate">{userInfo.fullName || "User Name"}</span>
                </div>
                <div className="flex flex-col gap-1 sm:pl-6 pt-4 sm:pt-0">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Occupation</span>
                  <span className="text-base font-black text-black uppercase tracking-tight truncate">{occupation || 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-1 sm:pl-6 pt-4 sm:pt-0">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Income Bracket</span>
                  <span className="text-base font-black text-black uppercase tracking-tight truncate">{incomeRange || 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-1 sm:pl-6 pt-4 sm:pt-0">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Co-applicant</span>
                  <span className="text-base font-black text-black uppercase tracking-tight truncate">{coApplicant || 'None'}</span>
                </div>
              </div>
            </div>

            <Card className="bg-green-50 border-green-300">
              <CardContent className="p-4 flex items-center gap-4">
                <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-green-600">Application Snapshot</h4>
                  <p className="text-xs text-slate-600 mt-0.5">Based on your inputs, your application has a <strong className="text-slate-900">Moderate to High</strong> chance of preliminary approval.</p>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between items-center pt-8 border-t-[1.5px] border-black">
              <Button variant="ghost" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3" disabled={isSubmitting}>EDIT DETAILS</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-blue-600 text-white hover:bg-blue-700 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-8 py-3 transition-all">
                {isSubmitting ? 'SUBMITTING...' : 'SUBMIT APPLICATION →'}
              </Button>
            </div>
          </div>
        )}

        {/* ---------------- EDUCATION LOAN SPECIALIZED FLOW ---------------- */}

        {/* EDU STEP 1: Basic Information */}
        {step === 1 && loanType === 'education' && (
          <form onSubmit={(e) => { e.preventDefault(); nextStep(); }} className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-300">
            <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase">STUDENT DETAILS</h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <Card className="bg-white border-slate-300">
                  <CardContent className="p-6 space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-slate-700 border-b border-slate-200 pb-2">Pre-filled Identity (from Signup)</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Full Name</Label><Input value={loadingUserInfo ? "Loading..." : userInfo.fullName} readOnly className="bg-slate-100 border-slate-300 text-slate-900" /></div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Date of Birth <span className="text-red-500">*</span></Label>
                          <Input
                            type="text"
                            placeholder="DD-MM-YYYY"
                            value={dateOfBirth}
                            onChange={(e) => {
                              setDateOfBirth(e.target.value);
                              const calculatedAge = calculateAge(e.target.value);
                              if (calculatedAge) setAge(calculatedAge);
                            }}
                            className="bg-white border-slate-300 text-slate-900"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Age (Years)</Label>
                          <Input
                            type="text"
                            value={age}
                            onChange={(e) => setAge(e.target.value)}
                            placeholder="Auto-calculated from DOB"
                            className="bg-white border-slate-300 text-slate-900"
                          />
                        </div>
                        <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Phone Number</Label><Input value={loadingUserInfo ? "Loading..." : userInfo.phone} readOnly className="bg-slate-100 border-slate-300 text-slate-900" /></div>
                        <div className="space-y-1.5 col-span-2"><Label className="text-slate-600 text-xs">Email</Label><Input value={loadingUserInfo ? "Loading..." : userInfo.email} readOnly className="bg-slate-100 border-slate-300 text-slate-900" /></div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-slate-200">
                      <h3 className="text-sm font-medium text-slate-700">Personal Information</h3>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Gender <span className="text-red-500">*</span></Label>
                          <Select value={gender} onValueChange={setGender}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                              <SelectItem value="prefer-not">Prefer not to say</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Marital Status <span className="text-red-500">*</span></Label>
                          <Select value={maritalStatus} onValueChange={setMaritalStatus}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="single">Single</SelectItem>
                              <SelectItem value="married">Married</SelectItem>
                              <SelectItem value="divorced">Divorced</SelectItem>
                              <SelectItem value="widowed">Widowed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-slate-600 text-xs">Number of Family Members</Label>
                          <Select value={familyMembersCount} onValueChange={setFamilyMembersCount}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                              <SelectValue placeholder="Select count" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                              <SelectItem value="4">4</SelectItem>
                              <SelectItem value="5">5</SelectItem>
                              <SelectItem value="6+">6 or more</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {maritalStatus === "married" && (
                          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                            <Label className="text-slate-600 text-xs">Number of Children</Label>
                            <Select value={childrenCount} onValueChange={setChildrenCount}>
                              <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full">
                                <SelectValue placeholder="Select count" />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-slate-300 text-slate-900">
                                <SelectItem value="0">0</SelectItem>
                                <SelectItem value="1">1</SelectItem>
                                <SelectItem value="2">2</SelectItem>
                                <SelectItem value="3">3</SelectItem>
                                <SelectItem value="4+">4 or more</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-slate-200">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600 text-xs">Family Income Range <span className="text-red-500">*</span></Label>
                        <Select value={incomeRange} onValueChange={setIncomeRange}>
                          <SelectTrigger className="bg-white border-slate-300 text-slate-900 w-full"><SelectValue placeholder="Select income range" /></SelectTrigger>
                          <SelectContent className="bg-white border-slate-300 text-slate-900">
                            <SelectItem value="<2L">Less than ₹2 Lakhs</SelectItem>
                            <SelectItem value="2-5L">₹2 - ₹5 Lakhs</SelectItem>
                            <SelectItem value="5-10L">₹5 - ₹10 Lakhs</SelectItem>
                            <SelectItem value=">10L">Above ₹10 Lakhs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-3 pt-2">
                        <Label className="text-slate-600 text-xs">Do you have a co-applicant?</Label>
                        <p className="text-xs text-blue-600">Education loans are usually supported by a co-applicant (e.g. parent, guardian).</p>
                        <RadioGroup value={coApplicant} onValueChange={setCoApplicant} className="flex gap-6 mt-1">
                          <div className="flex items-center space-x-2"><RadioGroupItem value="yes" id="edu-r1" className="border-slate-400 text-blue-600" /><Label htmlFor="edu-r1" className="text-slate-900 font-normal cursor-pointer">Yes</Label></div>
                          <div className="flex items-center space-x-2"><RadioGroupItem value="no" id="edu-r2" className="border-slate-400 text-blue-600" /><Label htmlFor="edu-r2" className="text-slate-900 font-normal cursor-pointer">No</Label></div>
                        </RadioGroup>
                      </div>

                      {coApplicant === "yes" && (
                        <div className="grid grid-cols-2 gap-4 pt-4 animate-in fade-in slide-in-from-top-2">
                          <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Co-applicant Name</Label><Input placeholder="Full Name" className="bg-white border-slate-300 text-slate-900" /></div>
                          <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Relationship</Label><Input placeholder="e.g. Father, Mother" className="bg-white border-slate-300 text-slate-900" /></div>
                          <div className="space-y-1.5"><Label className="text-slate-600 text-xs">Co-applicant Income Range</Label>
                            <Select>
                              <SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select Range" /></SelectTrigger>
                              <SelectContent className="bg-white border-slate-300 text-slate-900">
                                <SelectItem value="<2L">Less than ₹2 Lakhs</SelectItem>
                                <SelectItem value="2-5L">₹2 - ₹5 Lakhs</SelectItem>
                                <SelectItem value=">5L">Above ₹5 Lakhs</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {stepError && (
                  <div className="bg-red-50 border-[1.5px] border-black p-4 flex items-start gap-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] mb-6 animate-in fade-in slide-in-from-bottom-2">
                    <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-black text-red-600 uppercase tracking-widest">Missing Details</h4>
                      <p className="text-xs font-bold text-red-700 mt-1 uppercase tracking-wide leading-relaxed">PLEASE COMPLETE: {stepError}</p>
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button type="button" variant="outline" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3">BACK</Button>
                  <Button type="submit" disabled={false} className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-6 py-3 transition-all">CONTINUE &rarr;</Button>
                </div>
              </div>

              <div className="space-y-4">
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-6 text-xs text-slate-600 space-y-3 leading-relaxed">
                    <p className="flex gap-2 items-start"><InfoIcon className="w-4 h-4 text-blue-600 flex-shrink-0" /> We use pre-filled basic info to speed up your application.</p>
                    <p className="flex gap-2 items-start"><CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" /> Co-applicants dramatically improve loan approval odds for students.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </form>
        )}

        {/* EDU STEP 2: Loan + Study Details */}
        {step === 2 && loanType === 'education' && (
          <form onSubmit={(e) => { e.preventDefault(); nextStep(); }} className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-300">
            <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase">LOAN & EDUCATION DETAILS</h2>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <Card className="bg-white border-slate-300">
                  <CardContent className="p-6 space-y-8">

                    {/* Loan specific */}
                    <div className="space-y-4 border-b-[1.5px] border-black pb-8">
                      <h3 className="text-sm font-black text-blue-600 uppercase tracking-widest">1. Loan Parameters</h3>

                      <div className="flex justify-between items-end">
                        <Label className="text-black font-black uppercase tracking-wider text-xs">Desired Loan Amount</Label>
                        <div className="bg-white border-[1.5px] border-black px-3 py-1.5 flex items-center gap-2">
                          <span className="text-black font-bold">₹</span>
                          <Input type="number" className="bg-transparent border-0 h-8 w-28 text-right text-lg font-black text-black focus-visible:ring-0 p-0" value={loanAmount[0]} onChange={(e) => setLoanAmount([Number(e.target.value)])} />
                        </div>
                      </div>
                      <Slider max={5000000} min={50000} step={10000} value={loanAmount} onValueChange={setLoanAmount} className="py-4" />

                      <div className="space-y-3 mt-6">
                        <Label className="text-black font-black uppercase tracking-wider text-xs">Target Repayment Tenure (Years)</Label>
                        <Select value={tenure} onValueChange={setTenure}>
                          <SelectTrigger className="bg-white border-[1.5px] border-black text-black font-black h-12 rounded-none px-4"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-white border-slate-300 text-slate-900">
                            <SelectItem value="36">3 Years</SelectItem>
                            <SelectItem value="60">5 Years</SelectItem>
                            <SelectItem value="84">7 Years</SelectItem>
                            <SelectItem value="120">10 Years</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2 px-1">Repayment typically begins after course completion.</p>
                      </div>
                    </div>

                    {/* Education specific */}
                    <div className="space-y-4 border-b-[1.5px] border-black pb-8">
                      <h3 className="text-sm font-black text-blue-600 uppercase tracking-widest">2. Study Details</h3>

                      <div className="grid sm:grid-cols-2 gap-6">
                        <div className="space-y-2 pt-1">
                          <Label className="text-xs text-black font-black uppercase tracking-wider">Course Name <span className="text-red-500">*</span></Label>
                          <Select value={courseName} onValueChange={setCourseName}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue placeholder="Select Course" /></SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900 max-h-[300px] overflow-y-auto">
                              {["B.Tech / B.E.", "M.Tech / M.E.", "MBA / PGDM", "BBA / BMS", "BCA / MCA", "MBBS / BDS / Nursing", "B.Com / M.Com / CA / CS", "B.A. / M.A. / B.Sc / M.Sc", "Law (LLB / LLM)", "Design (B.Des / M.Des)", "Architecture (B.Arch)", "Hotel Management", "Aviation / Commercial Pilot", "Diplomas / Certifications", "Other"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label className="text-xs text-slate-600">University / Institution <span className="text-red-500">*</span></Label><Input placeholder="e.g. IIT Delhi" value={university} onChange={e => setUniversity(e.target.value)} className="bg-white border-slate-300 text-slate-900" required /></div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-600">Study Location</Label>
                          <Select value={studyLocation} onValueChange={setStudyLocation}>
                            <SelectTrigger className="bg-white border-slate-300 text-slate-900"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-white border-slate-300 text-slate-900">
                              <SelectItem value="India">India</SelectItem>
                              <SelectItem value="Abroad">Abroad</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label className="text-xs text-slate-600">Duration of Study (Years) <span className="text-red-500">*</span></Label><Input type="number" step="0.5" placeholder="e.g. 4" value={courseDuration} onChange={e => setCourseDuration(e.target.value)} className="bg-white border-slate-300 text-slate-900" required /></div>
                      </div>
                    </div>

                    {/* Document Uploads Inline */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-semibold text-blue-600 uppercase tracking-wide">3. Required Documents</h3>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <label className="block w-full cursor-pointer relative">
                          <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => handleIdentityFileChange(e.target.files?.[0] || null)} />
                          <Card className={`bg-white border-dashed ${identityFile ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors group h-full`}>
                            <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100"><FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600" /></div>
                              <div className="flex-1">
                                <h4 className="text-sm font-medium text-slate-900 mb-0.5">Admission Letter</h4>
                                <p className="text-xs text-slate-600 line-clamp-1">{identityFile ? identityFile.name : 'Offer letter or ID'}</p>
                                {ocrLoading && <p className="text-xs text-blue-500 mt-0.5">Analysing document…</p>}
                                {ocrResult?.identityVerified && <p className="text-xs text-green-600 mt-0.5">✓ Identity verified{ocrResult.name ? ` · ${ocrResult.name}` : ''}{ocrResult.idNumber ? ` · ${ocrResult.idNumber}` : ''}</p>}
                                {ocrError && <p className="text-xs text-amber-600 mt-0.5">⚠ {ocrError}</p>}
                              </div>
                            </CardContent>
                          </Card>
                        </label>
                        <label className="block w-full cursor-pointer relative">
                          <input type="file" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" onChange={(e) => setFinancialFile(e.target.files?.[0] || null)} />
                          <Card className={`bg-white border-dashed ${financialFile ? 'border-blue-600' : 'border-slate-300'} hover:border-blue-600 transition-colors group h-full`}>
                            <CardContent className="p-4 flex items-center gap-4 h-full relative overflow-hidden">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-slate-100 group-hover:bg-blue-100"><FileText className="w-5 h-5 text-slate-600 group-hover:text-blue-600" /></div>
                              <div className="flex-1">
                                <h4 className="text-sm font-medium text-slate-900 mb-0.5">Fee Structure</h4>
                                <p className="text-xs text-slate-600 line-clamp-1">{financialFile ? financialFile.name : 'Tuition breakdown'}</p>
                              </div>
                            </CardContent>
                          </Card>
                        </label>
                      </div>
                    </div>

                  </CardContent>
                </Card>

                {stepError && (
                  <div className="bg-red-50 border-[1.5px] border-black p-4 flex items-start gap-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] mb-6 animate-in fade-in slide-in-from-bottom-2">
                    <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-black text-red-600 uppercase tracking-widest">Missing Details</h4>
                      <p className="text-xs font-bold text-red-700 mt-1 uppercase tracking-wide leading-relaxed">PLEASE COMPLETE: {stepError}</p>
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button type="button" variant="outline" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3">BACK</Button>
                  <Button type="submit" disabled={false} className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-6 py-3 transition-all">REVIEW & SUBMIT &rarr;</Button>
                </div>
              </div>

              {/* Education Dashboard Insights */}
              <div className="space-y-6 pt-2">
                <Card className="bg-white border-[1.5px] border-black rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                  <CardHeader className="pb-4 border-b-[1.5px] border-black bg-slate-50"><CardTitle className="text-lg font-black text-black uppercase tracking-widest">Repayment Estimate</CardTitle></CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    <div className="text-center pb-6 border-b-[1.5px] border-black">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Estimated EMI (After Grad)</p>
                      <p className="text-5xl font-black text-black tracking-tighter">₹{Math.round(emi).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="space-y-4 text-sm font-bold uppercase tracking-wider text-slate-800">
                      <div className="flex justify-between items-center text-slate-600"><span className="text-slate-500">Course Duration</span><span className="text-black font-black text-base">{courseDuration || "0"} Years</span></div>
                      <div className="flex justify-between items-center text-slate-600"><span className="text-slate-500">Target Tenure</span><span className="text-black font-black text-base">{Number(tenure) / 12} Years</span></div>
                      <div className="flex flex-col gap-1 items-start text-xs font-semibold pt-4 border-t-[1.5px] border-black">
                        <span className="text-black font-black uppercase tracking-widest flex gap-2.5 items-center mt-2 w-full"><CheckCircle2 className="w-5 h-5 text-blue-600" /> Repayment begins in {courseDuration || "0"} Years.</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white border-[1.5px] border-black rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                  <CardHeader className="pb-3 border-b-[1.5px] border-black bg-blue-50/50">
                    <CardTitle className="text-sm font-black text-black uppercase tracking-widest flex items-center gap-2">
                      <InfoIcon className="w-5 h-5 text-blue-600" /> IMPORTANT INFO
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 text-xs font-bold text-slate-800 space-y-4 leading-relaxed tracking-wide uppercase">
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-black flex-shrink-0">•</span><p>Higher course duration delays repayment start but accrues simple interest.</p></div>
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-black flex-shrink-0">•</span><p>Higher loan amount increases your future monthly EMI after graduation.</p></div>
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-black flex-shrink-0">•</span><p>Include a co-applicant in Step 1 to maximize approval thresholds.</p></div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </form>
        )}

        {/* EDU STEP 3: Review & Submit */}
        {step === 3 && loanType === 'education' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-300 max-w-3xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4"><FileText className="w-8 h-8 text-blue-600" /></div>
              <h2 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-2">REVIEW EDUCATION APPLICATION</h2>
              <p className="text-xs font-bold text-black/40 uppercase tracking-[0.2em]">Almost there! Your profile is tailored as a Student.</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="border-[1.5px] border-black bg-white p-6 flex flex-col justify-between h-full relative shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <div className="space-y-1 z-10">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.15em]">Education Loan</span>
                  <p className="text-4xl font-black text-blue-600 tracking-tighter mt-4">₹{loanAmount[0].toLocaleString('en-IN')}</p>
                  <p className="text-sm font-bold text-black uppercase tracking-wider mt-1">for {tenure} months</p>
                </div>
              </div>

              <div className="border-[1.5px] border-black bg-slate-50 p-6 flex flex-col justify-between h-full shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <div className="space-y-1 z-10">
                  <span className="text-xs font-black text-black/40 uppercase tracking-[0.15em]">Future Repayment</span>
                  <div className="flex items-baseline gap-1 mt-4">
                    <p className="text-4xl font-black text-black tracking-tighter">₹{Math.round(emi).toLocaleString('en-IN')}</p>
                    <span className="text-sm font-bold text-black/40 uppercase tracking-widest">/mo</span>
                  </div>
                  <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 border-[1.5px] border-black uppercase tracking-wider text-blue-600 w-fit">
                    <InfoIcon className="w-4 h-4" /> STARTS AFTER {courseDuration || "0"} YEARS
                  </div>
                </div>
              </div>

              <div className="sm:col-span-2 border-[1.5px] border-black bg-white p-6 grid grid-cols-2 sm:grid-cols-4 gap-6 divide-y sm:divide-y-0 sm:divide-x-[1.5px] divide-black shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <div className="flex flex-col gap-1 sm:pt-0 pt-0"><span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Applicant</span><span className="text-base font-black text-black uppercase tracking-tight truncate">{userInfo.fullName || "Student"}</span></div>
                <div className="flex flex-col gap-1 sm:pl-6 pt-4 sm:pt-0"><span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Course</span><span className="text-base font-black text-black uppercase tracking-tight truncate">{courseName || '-'}</span></div>
                <div className="flex flex-col gap-1 sm:pl-6 pt-4 sm:pt-0"><span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">University</span><span className="text-base font-black text-black uppercase tracking-tight truncate">{university || '-'}</span></div>
                <div className="flex flex-col gap-1 sm:pl-6 pt-4 sm:pt-0"><span className="text-xs font-black text-black/40 uppercase tracking-[0.1em]">Co-applicant</span><span className="text-base font-black text-black uppercase tracking-tight truncate">{coApplicant === 'yes' ? 'Yes' : 'No'}</span></div>
              </div>
            </div>

            <Card className="bg-white border-[1.5px] border-black rounded-none shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <CardContent className="p-5 flex items-start gap-4">
                <CheckCircle2 className="w-7 h-7 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-black text-black uppercase tracking-widest">Application Snapshot</h4>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-widest leading-relaxed mt-2">APPROVAL DEPENDS HEAVILY ON YOUR PROFILE AND CO-APPLICANT DETAILS. ENSURE ACCURATE DOCUMENTS ARE OPTIONALLY PROVIDED.</p>
                </div>
              </CardContent>
            </Card>

            {submitError && (
              <Card className="bg-red-50 border-red-300">
                <CardContent className="p-4 flex items-start gap-4">
                  <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-red-600">Submission Error</h4>
                    <p className="text-xs text-red-700 mt-0.5 whitespace-pre-wrap">{submitError}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-between items-center pt-8 border-t-[1.5px] border-black">
              <Button variant="ghost" onClick={prevStep} className="border-[1.5px] border-black text-black hover:bg-gray-100 rounded-none font-black text-xs uppercase tracking-[0.15em] px-6 py-3" disabled={isSubmitting}>EDIT DETAILS</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-blue-600 text-white hover:bg-blue-700 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-8 py-3 transition-all">
                {isSubmitting ? 'SUBMITTING...' : 'SUBMIT APPLICATION →'}
              </Button>
            </div>
          </div>
        )}

      </main>

      {/* Camera Modal overlay */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center animate-in fade-in duration-200">
          <div className="absolute top-4 right-4 z-[60]">
            <Button variant="ghost" size="icon" onClick={stopCamera} className="text-white hover:bg-white/10 rounded-full w-12 h-12 bg-black/50">
              <X className="w-6 h-6" />
            </Button>
          </div>

          <div className="relative w-full max-w-lg aspect-[3/4] sm:aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Overlay guidelines */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8">
              <div className="w-48 h-64 border-2 border-white/30 rounded-full flex flex-col items-center justify-end pb-8 relative">
                <div className="text-center absolute -bottom-12 w-full text-white text-sm font-medium drop-shadow-md">
                  Position your face here
                </div>
              </div>
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-10 w-full px-6 justify-center">
              <Button onClick={capturePhoto} className="bg-white text-black hover:bg-gray-200 rounded-full w-16 h-16 flex items-center justify-center shadow-lg border-4 border-gray-300">
                <Camera className="w-6 h-6" />
              </Button>
            </div>
          </div>
          <p className="text-gray-400 mt-6 text-sm text-center max-w-sm px-4">
            Please ensure you are in a well-lit area. This photo will be used to verify your identity.
          </p>
        </div>
      )}
    </div>
  );
}
