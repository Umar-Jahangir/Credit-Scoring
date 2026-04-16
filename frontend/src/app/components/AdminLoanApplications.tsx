import { useState, useEffect } from "react";
import { Search, X, CreditCard, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:8000/api';

/** Matches backend alternateDisplayAlignment: PD ↔ headline blended score */
function alternatePdFromBlendedCreditScore(score: number): number {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  const raw = 1 - (s - 300) / 550;
  return Math.max(0.05, Math.min(0.95, raw));
}

function alternateRiskLevelFromScore(score: number): string {
  const s = Number(score);
  if (!Number.isFinite(s)) return "Unknown";
  if (s >= 700) return "Low";
  if (s >= 590) return "Medium";
  return "High";
}

function isUnbankedLoan(loan: any): boolean {
  return loan?.applicantType === "unbanked" || loan?.features?.underwritingPath === "unbanked";
}

export function AdminLoanApplications() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [selectedLoan, setSelectedLoan] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [approvalData, setApprovalData] = useState({
    approvedAmount: 0,
    interestRate: 12.5,
    tenure: 60,
    notes: ''
  });
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [explainability, setExplainability] = useState<any | null>(null);
  const [explainabilityLoading, setExplainabilityLoading] = useState(false);
  const [alternateAttachLoading, setAlternateAttachLoading] = useState(false);
  const [adminUpiFile, setAdminUpiFile] = useState<File | null>(null);
  const [adminUtilityFile, setAdminUtilityFile] = useState<File | null>(null);

  const formatRiskFlag = (flag: string) => {
    if (!flag) return "unknown_flag";
    if (flag.startsWith("ml_dependency_missing:")) {
      const dep = flag.split(":")[1] || "unknown";
      return `ML dependency missing (${dep})`;
    }
    if (flag === "ml_timeout") return "ML inference timed out";
    if (flag === "ml_invalid_output") return "ML returned invalid output";
    if (flag === "ml_inference_failed") return "ML inference failed";
    return flag.length > 72 ? `${flag.slice(0, 72)}...` : flag;
  };

  const STATUS_GROUPS: Record<string, string[]> = {
    Pending: ["under_review", "pending"],
    Approved: ["approved", "auto_approved", "accepted", "disbursed", "closed"],
    Rejected: ["rejected", "declined"],
    "Auto Rejected": ["auto_rejected"],
  };

  const matchesFilterStatus = (status: string, tab: string) => {
    if (tab === "All") return true;
    const group = STATUS_GROUPS[tab] || [];
    return group.includes(status);
  };

  const getStatusBadgeClass = (status: string) => {
    const normalized = String(status || "").toLowerCase();
    if (STATUS_GROUPS["Auto Rejected"].includes(normalized)) {
      return "bg-red-600/20 text-red-500";
    }
    if (STATUS_GROUPS.Rejected.includes(normalized)) {
      return "bg-red-500/20 text-red-400";
    }
    if (STATUS_GROUPS.Approved.includes(normalized)) {
      return "bg-green-500/20 text-green-400";
    }
    if (STATUS_GROUPS.Pending.includes(normalized)) {
      return "bg-yellow-500/20 text-yellow-500";
    }
    return "bg-gray-500/20 text-gray-400";
  };

  const getDisplayStatus = (status: string) => {
    const normalized = String(status || "").toLowerCase();
    if (STATUS_GROUPS["Auto Rejected"].includes(normalized)) return "Auto Rejected";
    if (STATUS_GROUPS.Rejected.includes(normalized)) return "Rejected";
    if (STATUS_GROUPS.Approved.includes(normalized)) return "Approved";
    if (STATUS_GROUPS.Pending.includes(normalized)) return "Pending";
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
  };

  useEffect(() => {
    fetchLoans();

    const interval = setInterval(() => {
      fetchLoans();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const fetchLoans = async () => {
    try {
      console.log('🔄 [Admin] Fetching loans from backend...');
      const response = await apiClient.get(`${API_BASE_URL}/admin/my-loans`);

      if (response.ok) {
        const data = await response.json();
        console.log(` [Admin] Fetched ${data.loans?.length || 0} loans`);
        const loansData = (data.loans || data.data?.loans || []).map((loan: any, index: number) => {
          // Extract user details from populated userId field
          const userDetails = loan.userId || {};
          const userName = userDetails.fullName || userDetails.name || 'Unknown User';
          const userPhone = userDetails.phone || 'N/A';
          const userEmail = userDetails.email || 'N/A';
          // Use the credit score captured at the time of this loan's AI analysis
          const creditScore =
            loan.aiAnalysis?.creditScore ?? userDetails.creditScore ?? 'N/A';

          const unbanked = isUnbankedLoan(loan);
          const aiScoreNum = Number(loan.aiAnalysis?.creditScore);
          let displayAltPd = loan.features?.probabilityOfDefault ?? 0;
          let displayAltRisk =
            ((loan.aiAnalysis?.riskLevel || 'unknown') as string).charAt(0).toUpperCase() +
            ((loan.aiAnalysis?.riskLevel || 'unknown') as string).slice(1);
          if (unbanked && Number.isFinite(aiScoreNum)) {
            displayAltPd = alternatePdFromBlendedCreditScore(aiScoreNum);
            displayAltRisk = alternateRiskLevelFromScore(aiScoreNum);
          }

          const loanType = loan.loanType || "";
          const typePrefixMap: Record<string, string> = {
            personal: "P",
            home: "H",
            auto: "A",
            education: "E",
            business: "B",
            credit_card: "C",
          };
          const prefix = typePrefixMap[loanType] || "X";
          const fallbackCode = `${prefix}${String(loan._id || "").slice(-4).toUpperCase()}`;
          const loanCode = loan.loanCode || fallbackCode;

          return {
            id: loan._id,
            loanCode,
            name: userName,
            phone: userPhone,
            email: userEmail,
            creditScore: creditScore,
            userId: userDetails._id,
            category: loanType,
            loanAmount: loan.requestedAmount,
            tenure: loan.requestedTenure,
            status: (() => {
              const sl = String(loan.status || '').toLowerCase();
              const score = Number(loan.aiAnalysis?.creditScore || userDetails.creditScore || 600);
              if (score < 440 || sl === 'auto_rejected') return 'auto_rejected';
              if (['approved', 'auto_approved', 'accepted', 'disbursed', 'closed'].includes(sl)) return 'approved';
              if (['rejected', 'declined'].includes(sl)) return 'rejected';
              return 'under_review';
            })(),
            riskLevel: displayAltRisk,
            riskScore: loan.aiAnalysis?.creditScore || 600,
            defaultProb: displayAltPd,
            interest: loan.aiAnalysis?.suggestedInterestRate ?? 0,
            decidedAmount: loan.aiAnalysis?.eligibleAmount ?? 0,
            decision: loan.features?.decision === 'Approve' ? 'APPROVE' : loan.features?.decision === 'Reject' ? 'REJECT' : 'REVIEW',
            isUserSubmitted: true,
            location: 'India',
            purpose: loan.purpose,
            rawLoan: loan,
            customDetails: {
              "Loan Type": loan.loanType,
              "Applicant Type": loan.applicantType || "banked",
              "Underwriting Path": loan.features?.underwritingPath || "banked_model",
              "Amount": `₹${(loan.requestedAmount / 100000).toFixed(1)}L`,
              "Tenure": `${loan.requestedTenure} months`,
              "Purpose": loan.purpose,
              "Eligible Amount": `₹${(loan.aiAnalysis?.eligibleAmount / 100000).toFixed(1)}L`,
              "Suggested Rate": `${loan.aiAnalysis?.suggestedInterestRate}% p.a.`,
              "Decision": loan.features?.decision || 'Hold',
              "Default Probability":
                unbanked || loan.features?.probabilityOfDefault != null
                  ? `${(displayAltPd * 100).toFixed(1)}%`
                  : "N/A",
              "Pre-screen": loan.features?.preScreenStatus || 'N/A',
              "Decision Reason": loan.features?.decisionReason || 'N/A',
              "Alt Completeness": loan.alternateUnderwriting?.dataCompletenessScore != null
                ? `${Math.round(loan.alternateUnderwriting.dataCompletenessScore * 100)}%`
                : "N/A",
              "Alt Confidence": loan.alternateUnderwriting?.confidenceLevel || "N/A",
              "Trust Score":
                loan.alternateUnderwriting?.trustScore != null
                  ? `${Math.round(loan.alternateUnderwriting.trustScore * 100)}%`
                  : loan.alternateUnderwriting?.explanationMetadata?.trustScore != null
                    ? `${Math.round(loan.alternateUnderwriting.explanationMetadata.trustScore * 100)}%`
                    : "N/A",
              "Fraud Risk":
                loan.alternateUnderwriting?.fraudRiskScore != null
                  ? `${Math.round(loan.alternateUnderwriting.fraudRiskScore * 100)}%`
                  : loan.alternateUnderwriting?.explanationMetadata?.fraudRiskScore != null
                    ? `${Math.round(loan.alternateUnderwriting.explanationMetadata.fraudRiskScore * 100)}%`
                    : "N/A",
              ...(loan.applicantType === "unbanked"
                ? {
                    "Alt Reference ID": loan.alternateReferenceId || "—",
                    "Alt scoring method": loan.alternateUnderwriting?.scoringMethod || "—",
                    "Admin vault/source": loan.alternateUnderwriting?.adminAttached?.source || "—",
                  }
                : {}),
            }
          };
        });
        setLoans(loansData);
        console.log(`📊 [Admin] Formatted ${loansData.length} loans`);
      }
    } catch (error) {
      console.error('[Admin] Error fetching loans:', error);
      setLoans([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch individual loan by ID (fresh data)
  const fetchLoanById = async (loanId: string) => {
    try {
      console.log(` [Admin] Fetching loan details for ID: ${loanId}`);

      // Prefer admin-scoped endpoint; fallback to user route for backward compatibility.
      let response = await apiClient.get(`${API_BASE_URL}/admin/my-loans/${loanId}`);

      if (!response.ok && (response.status === 404 || response.status === 405)) {
        console.warn(`⚠️ [Admin] Admin loan-by-id endpoint unavailable, falling back to user route (${response.status})`);
        response = await apiClient.get(`${API_BASE_URL}/loan/my-loans/${loanId}`);
      }

      if (!response.ok) {
        console.error(`[Admin] Failed to fetch loan (${response.status})`);
        return null;
      }

      const data = await response.json();
      console.log(` [Admin] Loan details fetched`, data.loan);

      return data.loan;
    } catch (err) {
      console.error('[Admin] Error fetching loan details:', err);
      return null;
    }
  };

  const attachAlternateVault = async (loanId: string) => {
    setAlternateAttachLoading(true);
      try {
        const res = await apiClient.post(
          `${API_BASE_URL}/admin/loans/${loanId}/alternate/vault`,
          {}
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || "Vault attach failed");
          return;
        }
        await fetchLoans();
        alert(data.message || "Vault data attached");
      } finally {
        setAlternateAttachLoading(false);
      }
  };

  const uploadAdminAlternateCsv = async (loanId: string) => {
    if (!adminUpiFile && !adminUtilityFile) {
      alert("Choose at least one CSV (UPI and/or utility)");
      return;
    }
    setAlternateAttachLoading(true);
      try {
        const form = new FormData();
        if (adminUpiFile) form.append("upi", adminUpiFile);
        if (adminUtilityFile) form.append("utility", adminUtilityFile);
        const token = localStorage.getItem("accessToken");
        const res = await fetch(
          `${API_BASE_URL}/admin/loans/${loanId}/alternate/upload`,
          {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || "Upload failed");
          return;
        }
        setAdminUpiFile(null);
        setAdminUtilityFile(null);
        await fetchLoans();
        alert(data.message || "Verified CSVs attached");
      } finally {
        setAlternateAttachLoading(false);
      }
  };

  const fetchExplainability = async (loanId: string) => {
    try {
      setExplainabilityLoading(true);
      const response = await apiClient.get(`${API_BASE_URL}/admin/loans/${loanId}/explainability`);
      if (!response.ok) {
        setExplainability(null);
        return;
      }
      const data = await response.json();
      setExplainability(data.explainability || null);
    } catch (error) {
      setExplainability(null);
    } finally {
      setExplainabilityLoading(false);
    }
  };

  // Handle loan row click - fetch fresh details by ID
  const handleLoanClick = async (index: number, loanId: string) => {
    console.log(`👆 [Admin] Loan row clicked: ${loanId} (index: ${index})`);

    // Immediately select the loan for UI responsiveness
    setSelectedLoan(index);
    setExplainability(null);
    void fetchExplainability(loanId);

    // Fetch fresh details by ID in background
    const freshLoan = await fetchLoanById(loanId);
    if (freshLoan) {
      // Update the loan in the list with fresh data
      const userDetails = freshLoan.userId || {};
      const loanType = freshLoan.loanType || "";
      const typePrefixMap: Record<string, string> = {
        personal: "P",
        home: "H",
        auto: "A",
        education: "E",
        business: "B",
        credit_card: "C",
      };
      const prefix = typePrefixMap[loanType] || "X";
      const fallbackCode = `${prefix}${String(freshLoan._id || "").slice(-4).toUpperCase()}`;
      const loanCode = freshLoan.loanCode || fallbackCode;
      const unbankedFresh = isUnbankedLoan(freshLoan);
      const aiScoreFresh = Number(freshLoan.aiAnalysis?.creditScore);
      let displayAltPdFresh = freshLoan.features?.probabilityOfDefault ?? 0;
      let displayAltRiskFresh =
        ((freshLoan.aiAnalysis?.riskLevel || 'unknown') as string).charAt(0).toUpperCase() +
        ((freshLoan.aiAnalysis?.riskLevel || 'unknown') as string).slice(1);
      if (unbankedFresh && Number.isFinite(aiScoreFresh)) {
        displayAltPdFresh = alternatePdFromBlendedCreditScore(aiScoreFresh);
        displayAltRiskFresh = alternateRiskLevelFromScore(aiScoreFresh);
      }
      const updatedLoan = {
        id: freshLoan._id,
        loanCode,
        name: userDetails.fullName || userDetails.name || 'Unknown User',
        phone: userDetails.phone || 'N/A',
        email: userDetails.email || 'N/A',
        // Keep this in sync with the list mapping: score at time of loan
        creditScore:
          freshLoan.aiAnalysis?.creditScore ?? userDetails.creditScore ?? 'N/A',
        userId: userDetails._id,
        category: loanType,
        loanAmount: freshLoan.requestedAmount,
        tenure: freshLoan.requestedTenure,
        status: (() => {
          const sl = String(freshLoan.status || '').toLowerCase();
          const score = Number(freshLoan.aiAnalysis?.creditScore || userDetails.creditScore || 600);
          if (score < 440 || sl === 'auto_rejected') return 'auto_rejected';
          if (['approved', 'auto_approved', 'accepted', 'disbursed', 'closed'].includes(sl)) return 'approved';
          if (['rejected', 'declined'].includes(sl)) return 'rejected';
          return 'under_review';
        })(),
        riskLevel: displayAltRiskFresh,
        riskScore: freshLoan.aiAnalysis?.creditScore || 600,
        defaultProb: displayAltPdFresh,
        interest: freshLoan.aiAnalysis?.suggestedInterestRate ?? 0,
        decidedAmount: freshLoan.aiAnalysis?.eligibleAmount ?? 0,
        decision: freshLoan.features?.decision === 'Approve' ? 'APPROVE' : freshLoan.features?.decision === 'Reject' ? 'REJECT' : 'REVIEW',
        isUserSubmitted: true,
        location: 'India',
        purpose: freshLoan.purpose,
        rawLoan: freshLoan,
        customDetails: {
          "Loan Type": freshLoan.loanType,
          "Applicant Type": freshLoan.applicantType || "banked",
          "Underwriting Path": freshLoan.features?.underwritingPath || "banked_model",
          "Amount": `₹${(freshLoan.requestedAmount / 100000).toFixed(1)}L`,
          "Tenure": `${freshLoan.requestedTenure} months`,
          "Purpose": freshLoan.purpose,
          "Eligible Amount": `₹${(freshLoan.aiAnalysis?.eligibleAmount / 100000).toFixed(1)}L`,
          "Suggested Rate": `${freshLoan.aiAnalysis?.suggestedInterestRate}% p.a.`,
          "Decision": freshLoan.features?.decision || 'Hold',
          "Default Probability":
            unbankedFresh || freshLoan.features?.probabilityOfDefault != null
              ? `${(displayAltPdFresh * 100).toFixed(1)}%`
              : "N/A",
          "Pre-screen": freshLoan.features?.preScreenStatus || 'N/A',
          "Decision Reason": freshLoan.features?.decisionReason || 'N/A',
          "Alt Completeness": freshLoan.alternateUnderwriting?.dataCompletenessScore != null
            ? `${Math.round(freshLoan.alternateUnderwriting.dataCompletenessScore * 100)}%`
            : "N/A",
          "Alt Confidence": freshLoan.alternateUnderwriting?.confidenceLevel || "N/A"
          ,"Trust Score": freshLoan.alternateUnderwriting?.explanationMetadata?.trustScore != null
            ? `${Math.round(freshLoan.alternateUnderwriting.explanationMetadata.trustScore * 100)}%`
            : "N/A"
          ,"Fraud Risk": freshLoan.alternateUnderwriting?.explanationMetadata?.fraudRiskScore != null
            ? `${Math.round(freshLoan.alternateUnderwriting.explanationMetadata.fraudRiskScore * 100)}%`
            : "N/A"
        }
      };

      // Update loan in list
      const updatedLoans = [...loans];
      updatedLoans[index] = updatedLoan;
      setLoans(updatedLoans);
      console.log(` [Admin] Updated loan with fresh data`);
    }
  };

  const filteredApplications = loans.filter(app => {
    const matchesTab = filterStatus === "All" || matchesFilterStatus(app.status, filterStatus);
    if (!matchesTab) return false;
    const normalizedSearch = searchTerm.toLowerCase();
    if (!normalizedSearch) return true;
    const code = (app.loanCode || "").toLowerCase();
    return app.name.toLowerCase().includes(normalizedSearch) ||
      app.category.toLowerCase().includes(normalizedSearch) ||
      code.includes(normalizedSearch);
  });

  const loan = selectedLoan !== null ? loans[selectedLoan] : null;

  const getStatusCount = (status: string) => {
    if (status === "All") return loans.length;
    return loans.filter(app => matchesFilterStatus(app.status, status)).length;
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "Low":
        return "text-green-400";
      case "Medium":
        return "text-yellow-400";
      case "High":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const getDecisionColor = (decision: string) => {
    switch (decision) {
      case "APPROVE":
        return "text-green-400 font-bold text-2xl";
      case "REJECT":
        return "text-red-400 font-bold text-2xl";
      case "REVIEW":
        return "text-yellow-400 font-bold text-2xl";
      default:
        return "text-gray-400 font-bold text-2xl";
    }
  };

  const buildExplainabilityNarrative = (loan: any, explainability: any) => {
    if (!loan || !explainability) return null;

    // If backend already provided an LLM-generated narrative, use it directly.
    if (explainability.llmNarrative) {
      const n = explainability.llmNarrative;
      if (Array.isArray(n.key_factors) && typeof n.detailed_explanation === "string") {
        return {
          keyFactors: n.key_factors,
          detailedExplanation: n.detailed_explanation,
        };
      }
    }

    const factors: string[] = [];

    const pd = typeof explainability.probabilityOfDefault === "number"
      ? explainability.probabilityOfDefault
      : null;
    const flags: string[] = Array.isArray(explainability.flags)
      ? explainability.flags
      : [];

    const rawBorrowerType: string | undefined =
      loan.rawLoan?.features?.borrowerType ||
      (Array.isArray(explainability.explanationSummary)
        ? (explainability.explanationSummary.find((item: string) =>
            typeof item === "string" && item.includes("borrowerType=")) as string | undefined)
        : undefined);

    let borrowerLabel: string | null = null;
    if (rawBorrowerType) {
      const match = rawBorrowerType.match(/borrowerType=([a-zA-Z0-9_]+)/);
      const code = (match?.[1] || rawBorrowerType).toLowerCase();
      if (code === "low_income_salaried") {
        borrowerLabel = "low-income salaried individual";
      } else if (code === "salaried") {
        borrowerLabel = "salaried individual";
      } else if (code === "self_employed") {
        borrowerLabel = "self-employed borrower";
      }
    }

    if (borrowerLabel) {
      factors.push(
        `The applicant appears to be a ${borrowerLabel}, which generally leaves limited surplus cash each month after regular living expenses.`
      );
    }

    if (loan.loanAmount) {
      factors.push(
        "The requested loan amount is sizeable for this income segment, increasing the monthly repayment burden relative to earnings."
      );
    }

    if (pd !== null) {
      factors.push(
        "Repayment capacity looks tight, so even modest income disruptions or unexpected expenses could make it difficult to keep up with EMIs."
      );
    }

    if (flags.includes("identity_unverified")) {
      factors.push(
        "Identity verification checks are not fully clear, adding operational and compliance risk on top of affordability concerns."
      );
    }

    if (factors.length === 0) {
      factors.push(
        "Available information suggests constrained repayment capacity and limited financial buffer, so the application should be treated cautiously."
      );
    }

    const detailedExplanation =
      "Taken together, these factors point to a borrower with constrained financial flexibility. " +
      (borrowerLabel
        ? `As a ${borrowerLabel}, the applicant is likely operating on a tight monthly budget, so loan repayments would consume a meaningful share of income. `
        : "Repayments would take up a meaningful share of the applicant's income. ") +
      (loan.loanAmount
        ? "The size of the requested loan further increases this burden, leaving less room to absorb shocks such as medical costs or employment changes. "
        : "This leaves limited room to absorb shocks such as medical costs or employment changes. ") +
      (flags.includes("identity_unverified")
        ? "In addition, unresolved identity verification issues introduce extra non-financial risk that should be resolved before approving the loan."
        : "Given these points, the case warrants careful manual review before any approval decision.");

    return { keyFactors: factors, detailedExplanation };
  };

  const handleApprove = () => {
    if (selectedLoan !== null && loans[selectedLoan]) {
      const loanAmount = loans[selectedLoan].loanAmount;
      setApprovalData({
        approvedAmount: loanAmount,
        interestRate: loans[selectedLoan].rawLoan?.aiAnalysis?.suggestedInterestRate || 12.5,
        tenure: loans[selectedLoan].tenure || 60,
        notes: ''
      });
      setApprovalModalOpen(true);
    }
  };

  const handleReject = () => {
    if (selectedLoan !== null) {
      setRejectionReason('');
      setRejectionModalOpen(true);
    }
  };

  const submitApproval = async () => {
    if (selectedLoan === null) return;

    const loanId = loans[selectedLoan].id;
    setActionLoading(true);

    try {
      const response = await apiClient.patch(`${API_BASE_URL}/admin/loans/${loanId}/approve`, approvalData);

      if (response.ok) {
        const data = await response.json();
        console.log('Loan approved:', data);
        setApprovalModalOpen(false);
        // Refresh loan list
        await fetchLoans();
        setSelectedLoan(null);
        // Also refresh dashboard data
        window.dispatchEvent(new Event('loanStatusChanged'));
      } else {
        const error = await response.json();
        alert(`Error approving loan: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error approving loan:', error);
      alert('Error approving loan. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const submitRejection = async () => {
    if (selectedLoan === null) return;

    const loanId = loans[selectedLoan].id;
    setActionLoading(true);

    try {
      const response = await apiClient.patch(`${API_BASE_URL}/admin/loans/${loanId}/reject`, { rejectionReason });

      if (response.ok) {
        const data = await response.json();
        console.log('Loan rejected:', data);
        setRejectionModalOpen(false);
        // Refresh loan list
        await fetchLoans();
        setSelectedLoan(null);
        // Also refresh dashboard data
        window.dispatchEvent(new Event('loanStatusChanged'));
      } else {
        const error = await response.json();
        alert(`Error rejecting loan: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error rejecting loan:', error);
      alert('Error rejecting loan. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
      <style>{`
        html {
          scrollbar-gutter: stable;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Modern Brutalist Header */}
      <header className="bg-white border-b-[1.5px] border-black flex-shrink-0 z-10 relative">
        <div className="w-full px-6 sm:px-8 md:px-10 lg:px-12">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-3">
              <img src="/images/download.png" alt="Barclays Logo" className="w-8 h-8 object-contain" />
              <span className="font-black text-xl sm:text-2xl text-black uppercase tracking-tight">CREDIT</span>
            </div>
            <nav className="hidden md:flex items-center gap-8 mt-1">
              <button onClick={() => navigate("/admin")} className="text-slate-900 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-600 transition-all pb-1.5 border-b-[3px] border-transparent hover:border-blue-600">Dashboard</button>
              {/* <button onClick={() => navigate("/admin/users")} className="text-slate-900 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-600 transition-all pb-1.5 border-b-[3px] border-transparent hover:border-blue-600">Users</button> */}
              <button onClick={() => navigate("/admin/loans")} className="text-blue-600 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-700 transition-all pb-1.5 border-b-[3px] border-blue-600">Loans</button>
              <button onClick={() => navigate("/admin/reports")} className="text-slate-900 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-600 transition-all pb-1.5 border-b-[3px] border-transparent hover:border-blue-600">Audit Log</button>
              <button onClick={() => navigate("/admin/models")} className="text-slate-900 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-600 transition-all pb-1.5 border-b-[3px] border-transparent hover:border-blue-600">Models</button>
              <button onClick={() => navigate("/admin/copilot")} className="text-slate-900 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-600 transition-all pb-1.5 border-b-[3px] border-transparent hover:border-blue-600">Chat</button>
            </nav>
            <Button
              onClick={() => logout()}
              variant="outline"
              className="border-[1.5px] border-black text-black bg-white hover:bg-black hover:text-white rounded-none font-black text-xs uppercase tracking-[0.15em] transition-all hover:scale-[1.03]"
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden max-w-full bg-[#fafafa]">
        {/* Left Panel - Loans Table */}
        <div className={`transition-all duration-300 border-r-[1.5px] border-black overflow-hidden flex flex-col min-w-0 ${selectedLoan !== null ? 'w-full lg:w-3/5' : 'w-full'}`}>
          <div className="p-8 space-y-6 flex flex-col h-full overflow-hidden animate-in fade-in duration-500">
            {/* Header with Title and Search */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 flex-shrink-0">
              <h1 className="text-4xl md:text-5xl font-black text-black tracking-tighter uppercase">LOAN APPLICATIONS</h1>
              <div className="relative w-full md:max-w-xs">
                <Search className="absolute left-4 top-3.5 w-5 h-5 text-black" />
                <input
                  type="text"
                  placeholder="SEARCH APPLICATIONS..."
                  className="w-full pl-12 pr-4 py-3 bg-white border-[1.5px] border-black rounded-none text-black placeholder-black/50 font-bold uppercase text-xs tracking-widest focus:outline-none focus:ring-0 focus:border-blue-600 focus:shadow-[4px_4px_0_0_rgba(37,99,235,1)] transition-all shadow-[2px_2px_0_0_rgba(0,0,0,1)]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* Filter Tabs - Single Row */}
            <div className="flex gap-4 items-center flex-wrap flex-shrink-0 pt-2">
              {["All", "Pending", "Approved", "Rejected", "Auto Rejected"].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-5 py-2.5 rounded-none text-xs font-black uppercase tracking-widest transition-all duration-200 shadow-[2px_2px_0_0_rgba(0,0,0,0.15)] hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_rgba(37,99,235,0.3)] flex items-center gap-2 ${filterStatus === status
                    ? "bg-blue-600 text-white border-[1.5px] border-blue-600"
                    : "bg-white text-black border-[1.5px] border-slate-300 hover:border-blue-600"
                    }`}
                >
                  {status} <span className={`inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full text-[10px] font-black ${filterStatus === status ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-600'}`}>{getStatusCount(status)}</span>
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto hide-scrollbar bg-white border border-slate-200 rounded-none relative shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-slate-50 border-b-[1.5px] border-slate-200 shadow-sm">
                  <tr>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">Loan ID</th>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">User</th>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">Category</th>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">Loan Amount</th>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">Tenure</th>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">EMI Estimate</th>
                    <th className="text-left py-4 px-6 text-[11px] font-black tracking-widest text-black uppercase whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredApplications.map((loanApp, idx) => (
                    <tr
                      key={loanApp.id}
                      onClick={() => handleLoanClick(loans.findIndex(l => l.id === loanApp.id), loanApp.id)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="py-5 px-6 text-sm font-black text-slate-700 uppercase tracking-widest whitespace-nowrap">
                        {loanApp.loanCode}
                      </td>
                      <td className="py-5 px-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 border-[1.5px] border-blue-600 bg-blue-600 flex items-center justify-center flex-shrink-0 rounded-full">
                            <span className="text-white font-black text-sm uppercase">{loanApp.name.charAt(0)}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-black text-black uppercase tracking-wider truncate">{loanApp.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-5 px-6 text-sm font-bold text-slate-700 uppercase tracking-widest whitespace-nowrap">{loanApp.category}</td>
                      <td className="py-5 px-6 text-lg font-black text-black tracking-tight whitespace-nowrap">
                        {loanApp.loanAmount ? `₹${(loanApp.loanAmount / 1000).toFixed(0)},000` : "₹0"}
                      </td>
                      <td className="py-5 px-6 text-sm font-bold text-slate-700 uppercase whitespace-nowrap">{loanApp.tenure || "0"} MO</td>
                      <td className="py-5 px-6 text-lg font-black text-black tracking-tight whitespace-nowrap">
                        {loanApp.rawLoan?.aiAnalysis?.suggestedInterestRate
                          ? `₹${Math.round((loanApp.loanAmount * (loanApp.rawLoan.aiAnalysis.suggestedInterestRate / 100 / 12)) / (1 - Math.pow(1 + (loanApp.rawLoan.aiAnalysis.suggestedInterestRate / 100 / 12), -loanApp.tenure)))}`
                          : "₹0"}
                      </td>
                      <td className="py-5 px-6 text-sm whitespace-nowrap">
                        <span className={`inline-flex items-center px-4 py-1.5 rounded-sm border text-xs font-black uppercase tracking-[0.1em] ${loanApp.status === 'approved'
                          ? 'bg-green-50 border-green-300 text-green-700'
                          : loanApp.status === 'under_review'
                            ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                            : loanApp.status === 'rejected'
                              ? 'bg-red-50 border-red-300 text-red-600'
                              : 'bg-gray-50 border-gray-300 text-gray-600'
                          }`}>
                          {loanApp.status === 'under_review' ? 'PENDING' :
                            loanApp.status === 'approved' ? 'APPROVED' :
                              loanApp.status === 'rejected' ? 'REJECTED' :
                                loanApp.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Panel - Loan Details (Conditional) */}
        {loan && selectedLoan !== null && (
          <div className="hidden lg:flex lg:w-2/5 flex-col bg-white border-l-[1.5px] border-black hide-scrollbar overflow-y-auto max-h-screen min-w-0 shadow-[-4px_0_15px_-5px_rgba(0,0,0,0.1)] z-10">
            <div className="p-8 space-y-8 flex-1 w-full overflow-x-hidden animate-in slide-in-from-right-8 duration-500">
              {/* Close Button */}
              <div className="flex justify-end mb-2 sticky top-0 z-20">
                <button onClick={() => setSelectedLoan(null)} className="text-black bg-white border-[1.5px] border-transparent hover:border-black hover:bg-black hover:text-white transition-all p-2 flex-shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* User Profile - Compact */}
              <div className="py-1">
                <h2 className="text-4xl font-black text-black uppercase tracking-tighter leading-none">{loan.name}</h2>
                <div className="flex justify-between items-center text-xs font-black tracking-widest text-slate-500 uppercase mt-4 border-b-[1.5px] border-black pb-4">
                  <span className="bg-slate-100 border-[1.5px] border-black text-black px-3 py-1">{loan.category}</span>
                  <span className="bg-black text-white border-[1.5px] border-black px-3 py-1 tracking-[0.2em]">{loan.loanCode}</span>
                  <span className="flex items-center gap-1">📍 {loan.location}</span>
                </div>

                {/* User Contact Details */}
                <div className="mt-6 bg-white border-[1.5px] border-black p-5 space-y-3 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between border-b border-black/10 pb-2">
                    <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Email</span>
                    <span className="text-sm text-black font-bold">{loan.email}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-black/10 pb-2">
                    <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Phone</span>
                    <span className="text-sm text-black font-bold">{loan.phone}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Credit Score</span>
                    <span className="text-2xl text-black font-black">{loan.creditScore}</span>
                  </div>
                </div>
              </div>

              {/* Risk Score */}
              <div className="flex flex-col gap-4 bg-white border-[1.5px] border-black p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)] group hover:border-blue-600 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-slate-500 tracking-widest">AI Risk Score</span>
                  <p className={`text-xs font-black uppercase px-3 py-1 border-[1.5px] border-black ${loan.riskLevel === 'Low' ? 'bg-green-400 text-black' :
                    loan.riskLevel === 'Medium' ? 'bg-yellow-400 text-black' :
                      'bg-red-500 text-white'
                    }`}>
                    {loan.riskLevel} RISK
                  </p>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-6xl font-black text-black tracking-tighter leading-none group-hover:text-blue-600 transition-colors">{loan.riskScore}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black text-black tracking-tighter leading-none">{(loan.defaultProb * 100).toFixed(1)}<span className="text-xl">%</span></p>
                    <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mt-1">Default Prob</p>
                  </div>
                </div>
              </div>

              {/* Loan Details */}
              <div className="bg-white p-5 border-[1.5px] border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-4 border-b-[1.5px] border-black pb-2">Loan Details</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-end border-b border-black/10 pb-2">
                    <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Requested</span>
                    <span className="text-lg text-black font-black leading-none">₹{loan.loanAmount?.toLocaleString() || "0"}</span>
                  </div>
                  {loan.decision !== "REJECT" && (
                    <>
                      <div className="flex justify-between items-end border-b border-black/10 pb-2">
                        <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Suggested</span>
                        <span className="text-xl text-blue-600 font-black leading-none">₹{loan.decidedAmount?.toLocaleString() || "0"}</span>
                      </div>
                      <div className="flex justify-between items-end border-b border-black/10 pb-2">
                        <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Interest (p.a.)</span>
                        <span className="text-lg text-black font-black leading-none">{loan.interest}%</span>
                      </div>
                      <div className="flex justify-between items-end pt-1">
                        <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Tenure</span>
                        <span className="text-lg text-black font-black leading-none">{loan.tenure} MO</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {loan.rawLoan?.applicantType === "unbanked" && (
                <div className="bg-amber-50 border-[1.5px] border-black p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)] space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] border-b border-black pb-2">
                    Unbanked — verified alternate data
                  </h3>
                  <p className="text-[11px] font-bold text-slate-700">
                    Reference ID:{" "}
                    <span className="font-black">{loan.rawLoan.alternateReferenceId || "—"}</span>
                  </p>
                  <p className="text-[10px] text-slate-600">
                    Demo vault keys: AAAAA1111A (strong both), BBBBB2222B (weak both), CCCCC3333C (UPI
                    only), DDDDD4444D (utility only), EEEEE5555E (no files).
                  </p>
                  <button
                    type="button"
                    disabled={alternateAttachLoading}
                    onClick={() => attachAlternateVault(String(loan.id))}
                    className="w-full text-xs font-black uppercase border-[1.5px] border-black bg-black text-white py-2 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {alternateAttachLoading ? "Working…" : "Load demo vault for this reference ID"}
                  </button>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase block">Verified UPI CSV (admin)</label>
                    <input
                      type="file"
                      accept=".csv"
                      className="text-xs w-full"
                      onChange={(e) => setAdminUpiFile(e.target.files?.[0] || null)}
                    />
                    <label className="text-[10px] font-black uppercase block">Verified utility CSV (admin)</label>
                    <input
                      type="file"
                      accept=".csv"
                      className="text-xs w-full"
                      onChange={(e) => setAdminUtilityFile(e.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      disabled={alternateAttachLoading}
                      onClick={() => uploadAdminAlternateCsv(String(loan.id))}
                      className="w-full text-xs font-black uppercase border-[1.5px] border-black bg-white py-2 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Attach verified CSVs &amp; re-score
                    </button>
                  </div>
                </div>
              )}

              {/* Explainability */}
              <div className="bg-black p-5 border-[1.5px] border-black shadow-[4px_4px_0_0_rgba(37,99,235,0.5)]">
                <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] mb-4 border-b-[1.5px] border-white/20 pb-2">Model Explainability</h3>
                {explainabilityLoading ? (
                  <p className="text-xs font-bold text-white/50 uppercase tracking-widest animate-pulse">Loading analysis...</p>
                ) : explainability ? (
                  <div className="space-y-3 text-sm">
                    {/* Top metadata */}
                    <div className="flex justify-between items-center border-b border-white/15 pb-2">
                      <span className="text-[10px] font-black uppercase text-white/55 tracking-widest">Model Version</span>
                      <span className="text-[11px] text-white font-bold bg-white/10 px-2 py-0.5 rounded-sm">
                        {explainability.modelVersion || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-b border-white/15 pb-2">
                      <span className="text-[10px] font-black uppercase text-white/55 tracking-widest">Scoring Source</span>
                      <span className="text-[11px] text-blue-300 font-bold uppercase tracking-wider">
                        {loan.rawLoan?.features?.scoringSource || explainability?.decisionSummary?.scoringSource || 'N/A'}
                      </span>
                    </div>
                    {explainability.decisionSummary && (
                      <div className="pt-3 border-t border-white/15 space-y-2">
                        <p className="text-[11px] font-black text-white/70 uppercase tracking-widest">Decision Summary</p>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/60 uppercase tracking-widest">Recommended Decision</span>
                          <span className="text-white font-semibold uppercase tracking-widest">
                            {explainability.decisionSummary.decision || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/60 uppercase tracking-widest">Pre-screen Status</span>
                          <span className="text-white font-semibold uppercase tracking-widest">
                            {explainability.decisionSummary.preScreenStatus || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/60 uppercase tracking-widest">Manual Review</span>
                          <span className="text-white font-semibold uppercase tracking-widest">
                            {explainability.decisionSummary.manualReviewRequired ? 'YES' : 'NO'}
                          </span>
                        </div>
                        {explainability.decisionSummary.decisionReason && (
                          <p className="text-[11px] text-white/85 bg-white/5 border border-white/15 rounded p-2 mt-1 leading-relaxed">
                            {explainability.decisionSummary.decisionReason}
                          </p>
                        )}
                      </div>
                    )}
                    {explainability.alternate?.mlShap?.topFeatures?.length > 0 && (
                      <div className="pt-3 border-t border-white/15">
                        <p className="text-[11px] font-semibold text-blue-200 mb-2 uppercase tracking-widest">
                          Alternate model (SHAP)
                        </p>
                        <ul className="space-y-1 max-h-40 overflow-y-auto">
                          {explainability.alternate.mlShap.topFeatures.map(
                            (row: { name: string; shapValue: number }, idx: number) => (
                              <li
                                key={idx}
                                className="text-[11px] text-white/90 flex justify-between gap-2"
                              >
                                <span className="truncate">{row.name}</span>
                                <span className="font-mono shrink-0">{row.shapValue}</span>
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(explainability.flags) && explainability.flags.length > 0 && (
                      <div className="pt-3 border-t border-white/15">
                        <p className="text-[11px] font-semibold text-white/80 mb-2 uppercase tracking-widest">Risk Flags</p>
                        <div className="flex flex-wrap gap-1">
                          {explainability.flags.slice(0, 8).map((flag: string, idx: number) => (
                            <span key={idx} className="text-[11px] px-2 py-1 rounded bg-amber-100 text-amber-900 border border-amber-300">
                              {formatRiskFlag(flag)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(() => {
                      const narrative = buildExplainabilityNarrative(loan, explainability);
                      if (!narrative) return null;
                      return (
                        <div className="pt-2 space-y-3">
                          <p className="text-[10px] font-black uppercase text-white/50 tracking-widest mb-1 border-l-2 border-blue-500 pl-2">Key Reasoning Factors</p>
                          <ul className="space-y-2">
                            {narrative.keyFactors.map((item: string, idx: number) => (
                              <li key={idx} className="text-xs text-white font-medium bg-white/5 p-2 border-[1.5px] border-white/10">
                                {item}
                              </li>
                            ))}
                          </ul>
                          <p className="text-[11px] text-white/80 leading-relaxed">
                            {narrative.detailedExplanation}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-xs font-bold text-white/50 uppercase tracking-widest">Explainability unavailable.</p>
                )}
              </div>
              {/* User Application Data */}
              {loan.isUserSubmitted ? (
                <div className="bg-white border border-slate-200 p-5 rounded-sm">
                  <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-4 border-b border-slate-200 pb-2 text-center">Submitted Details</h3>
                  <div className="space-y-2 pt-2">
                    {loan.customDetails && Object.entries(loan.customDetails).map(([key, val], idx) => (
                      <div key={idx} className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-sm px-3 py-2">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{key}</span>
                        <span className="text-xs font-black text-black uppercase tracking-wider text-right pl-4 truncate max-w-[50%]">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white p-5 border border-slate-200 rounded-sm">
                  <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-3">Eligibility Profile</h3>
                  <div className="space-y-2 text-xs font-bold uppercase tracking-widest text-center text-slate-400 py-4 border border-dashed border-slate-200 rounded-sm">
                    Mock applicant data
                  </div>
                </div>
              )}

              {/* Uploaded Documents */}
              {loan.submittedDocs && loan.submittedDocs.length > 0 && (
                <div className="bg-white border-[1.5px] border-black p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)] mt-4">
                  <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-4 border-b-[1.5px] border-black pb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Documents
                  </h3>
                  <div className="space-y-3">
                    {loan.submittedDocs.map((doc: string, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-50 p-3 border-[1.5px] border-black hover:bg-black hover:text-white transition-colors group">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-black group-hover:text-white transition-colors" />
                          <span className="text-xs font-bold truncate max-w-[160px] tracking-wider uppercase">{doc}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // In a real app this opens a modal or new tab, here we alert
                            alert(`Opening document viewer for: ${doc}`);
                          }}
                          className="h-8 text-[10px] font-black uppercase tracking-widest border-[1.5px] border-black text-black bg-white group-hover:bg-white group-hover:text-black hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all rounded-none px-4"
                        >
                          View
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}



              {/* Action Buttons */}
              {loan.status === 'under_review' && (
                <div className="flex gap-4 pt-6 mt-auto">
                  <Button onClick={handleApprove} className="flex-1 bg-green-400 hover:bg-green-500 text-black border-[1.5px] border-black rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-all font-black uppercase tracking-[0.15em] py-6 text-sm">
                    Approve Application
                  </Button>
                  <Button onClick={handleReject} className="flex-1 bg-red-500 hover:bg-red-600 text-white border-[1.5px] border-black rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-all font-black uppercase tracking-[0.15em] py-6 text-sm">
                    Reject Application
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Approval Modal */}
      {approvalModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white border-[2px] border-black rounded-none shadow-[12px_12px_0_0_rgba(0,0,0,1)] max-w-md w-full p-8 space-y-6">
            <div className="flex justify-between items-center border-b-[2px] border-black pb-4">
              <h2 className="text-2xl font-black text-black uppercase tracking-tighter">Approve Application</h2>
              <button onClick={() => setApprovalModalOpen(false)} className="text-black hover:text-blue-600 transition-colors bg-white border-[1.5px] border-black hover:border-blue-600 p-1">
                <X className="w-6 h-6" />
              </button>
            </div>

            {loan && (
              <div className="text-sm text-black mb-6 bg-slate-50 border-[1.5px] border-black p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <p className="flex justify-between border-b border-black/10 pb-2 mb-2">
                  <span className="font-black uppercase tracking-widest text-xs text-slate-500">Applicant:</span>
                  <span className="font-bold uppercase tracking-wider">{loan.name}</span>
                </p>
                <p className="flex justify-between">
                  <span className="font-black uppercase tracking-widest text-xs text-slate-500">Requested:</span>
                  <span className="font-bold uppercase tracking-wider">₹{(loan.loanAmount / 100000).toFixed(1)}L</span>
                </p>
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-black text-black uppercase tracking-widest mb-2">Approved Amount (₹)</label>
                <input
                  type="number"
                  value={approvalData.approvedAmount}
                  onChange={(e) => setApprovalData({ ...approvalData, approvedAmount: parseFloat(e.target.value) })}
                  className="w-full px-4 py-3 border-[2px] border-black rounded-none focus:outline-none focus:ring-0 focus:border-blue-600 font-bold uppercase tracking-wider transition-colors"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-black uppercase tracking-widest mb-2">Interest Rate (% p.a.)</label>
                <input
                  type="number"
                  step="0.1"
                  value={approvalData.interestRate}
                  onChange={(e) => setApprovalData({ ...approvalData, interestRate: parseFloat(e.target.value) })}
                  className="w-full px-4 py-3 border-[2px] border-black rounded-none focus:outline-none focus:ring-0 focus:border-blue-600 font-bold uppercase tracking-wider transition-colors"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-black uppercase tracking-widest mb-2">Tenure (months)</label>
                <input
                  type="number"
                  value={approvalData.tenure}
                  onChange={(e) => setApprovalData({ ...approvalData, tenure: parseInt(e.target.value) })}
                  className="w-full px-4 py-3 border-[2px] border-black rounded-none focus:outline-none focus:ring-0 focus:border-blue-600 font-bold uppercase tracking-wider transition-colors"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-black uppercase tracking-widest mb-2">Notes (Optional)</label>
                <textarea
                  value={approvalData.notes}
                  onChange={(e) => setApprovalData({ ...approvalData, notes: e.target.value })}
                  className="w-full px-4 py-3 border-[2px] border-black rounded-none focus:outline-none focus:ring-0 focus:border-blue-600 font-bold tracking-wider transition-colors"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex gap-4 justify-end pt-6 border-t-[2px] border-black">
              <Button
                onClick={() => setApprovalModalOpen(false)}
                variant="outline"
                className="border-[2px] border-black text-black rounded-none font-black uppercase tracking-widest hover:bg-black hover:text-white transition-all px-6 py-5"
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={submitApproval}
                className="bg-blue-600 border-[2px] border-black text-white rounded-none font-black uppercase tracking-widest hover:bg-blue-700 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-all px-8 py-5"
                disabled={actionLoading}
              >
                {actionLoading ? 'PROCESSING...' : 'CONFIRM APPROVAL'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectionModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white border-[2px] border-black rounded-none shadow-[12px_12px_0_0_rgba(0,0,0,1)] max-w-md w-full p-8 space-y-6">
            <div className="flex justify-between items-center border-b-[2px] border-black pb-4">
              <h2 className="text-2xl font-black text-black uppercase tracking-tighter">Reject Application</h2>
              <button onClick={() => setRejectionModalOpen(false)} className="text-black hover:text-red-600 transition-colors bg-white border-[1.5px] border-black hover:border-red-600 p-1">
                <X className="w-6 h-6" />
              </button>
            </div>

            {loan && (
              <div className="text-sm text-black mb-6 bg-slate-50 border-[1.5px] border-black p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                <p className="flex justify-between border-b border-black/10 pb-2 mb-2">
                  <span className="font-black uppercase tracking-widest text-xs text-slate-500">Applicant:</span>
                  <span className="font-bold uppercase tracking-wider">{loan.name}</span>
                </p>
                <p className="flex justify-between">
                  <span className="font-black uppercase tracking-widest text-xs text-slate-500">Category:</span>
                  <span className="font-bold uppercase tracking-wider">{loan.category}</span>
                </p>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black text-black uppercase tracking-widest mb-2">Rejection Reason</label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="PROVIDE REASON..."
                className="w-full px-4 py-3 border-[2px] border-black rounded-none focus:outline-none focus:ring-0 focus:border-red-600 font-bold tracking-wider transition-colors"
                rows={4}
              />
            </div>

            <div className="flex gap-4 justify-end pt-6 border-t-[2px] border-black">
              <Button
                onClick={() => setRejectionModalOpen(false)}
                variant="outline"
                className="border-[2px] border-black text-black rounded-none font-black uppercase tracking-widest hover:bg-black hover:text-white transition-all px-6 py-5"
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={submitRejection}
                className="bg-red-500 border-[2px] border-black text-white rounded-none font-black uppercase tracking-widest hover:bg-red-600 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-all px-8 py-5"
                disabled={actionLoading || !rejectionReason.trim()}
              >
                {actionLoading ? 'PROCESSING...' : 'CONFIRM REJECTION'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
