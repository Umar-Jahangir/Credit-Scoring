import { useState, useEffect } from "react";
import { 
  AlertCircle, CheckCircle2, 
  Ban, Info, X, ChevronRight
} from "lucide-react";
import { Button } from "./ui/button";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

const FILTER_OPTIONS = [
  "All",
  "Approved",
  "Rejected",
  "Auto Rejected",
  "Under Review",
];

const FILTER_STATUS_MAP: Record<string, string[]> = {
  Approved: [
    "approved",
    "auto_approved",
    "accepted",
    "disbursed",
    "ongoing",
    "completed",
    "closed",
  ],
  Rejected: ["rejected", "declined"],
  "Auto Rejected": ["auto_rejected"],
  "Under Review": ["pending", "under_review", "review", "hold", "processing"],
};

const safeNumber = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Unbanked headline blended score ↔ PD (matches backend alternateDisplayAlignment) */
function alternatePdFromBlendedCreditScore(score: number): number {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  const raw = 1 - (s - 300) / 550;
  return Math.max(0.05, Math.min(0.95, raw));
}

function alternateRiskLevelFromScore(score: number): string {
  const s = Number(score);
  if (!Number.isFinite(s)) return "medium";
  if (s >= 700) return "low";
  if (s >= 590) return "medium";
  return "high";
}

const formatCurrency = (value: any) =>
  safeNumber(value, 0).toLocaleString("en-IN");

export function MyLoansPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [filter, setFilter] = useState("All");
  const [selectedLoan, setSelectedLoan] = useState<any | null>(null);
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:8000/api';

  // Fetch loans from backend
  useEffect(() => {
    const fetchLoans = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('Fetching loans from backend...');
        const response = await apiClient.get(`${API_BASE_URL}/loan/my-loans`);

        console.log('Response status:', response.status, response.statusText);

        if (!response.ok) {
          const errorBody = await response.text();
          console.error('Backend error response:', errorBody);
          
          if (response.status === 500) {
            console.error('Server error (500)');
            throw new Error('Backend server error');
          }
          
          throw new Error(`Failed to fetch loans (HTTP ${response.status})`);
        }

        const data = await response.json();
        console.log('Response data:', JSON.stringify(data, null, 2));
        
        if (!data.loans) {
          console.warn('No loans array in response');
        }

        // Map backend loans to frontend format
        const loansArray = Array.isArray(data.loans) ? data.loans : [];
        console.log(`Total loans to display: ${loansArray.length}`);
        
        const formattedLoans = loansArray.map((loan: any) => {
          console.log(`Processing loan: ${loan._id} - Status: ${loan.status}`);
          const backendStatus = loan.status;
          const displayStatus = loan.displayStatus || formatStatus(backendStatus);
          const requestedAmount = safeNumber(loan.requestedAmount, 0);
          const tenureMonths = Math.max(1, safeNumber(loan.requestedTenure, 12));
          const rate = safeNumber(loan.aiAnalysis?.suggestedInterestRate, 12.5);
          const monthlyRate = rate / 100 / 12;
          const emi =
            monthlyRate > 0
              ? (requestedAmount * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
                (Math.pow(1 + monthlyRate, tenureMonths) - 1)
              : requestedAmount / tenureMonths;
          const totalPayable = Math.round(emi * tenureMonths);
          const isUnbanked =
            loan.applicantType === "unbanked" ||
            loan.features?.underwritingPath === "unbanked";
          const headScore = loan.aiAnalysis?.creditScore;
          let riskLevel = loan.aiAnalysis?.riskLevel || "medium";
          const baseFeat = { ...(loan.features || {}) };
          if (isUnbanked && headScore != null && Number.isFinite(Number(headScore))) {
            const s = Number(headScore);
            riskLevel = alternateRiskLevelFromScore(s);
            baseFeat.probabilityOfDefault = alternatePdFromBlendedCreditScore(s);
          }
          return {
            ...loan,
            id: loan._id,
            loanId: loan._id,
            amount: requestedAmount,
            status: displayStatus,
            loanType: loan.loanType,
            riskLevel,
            interestRate: rate,
            eligibleAmount: safeNumber(loan.aiAnalysis?.eligibleAmount, requestedAmount),
            creditScore: loan.aiAnalysis?.creditScore,
            applicationDate: loan.submittedAt ? new Date(loan.submittedAt).toLocaleDateString() : 'N/A',
            tenure: tenureMonths,
            category: normalizeLoanType(loan.loanType),
            submittedAt: loan.submittedAt,
            backendStatus,
            displayStatus,
            rejectionReason:
              loan.adminDecision?.rejectionReason ||
              loan.features?.decisionReason ||
              null,
            emi: Math.round(emi),
            totalPayable,
            remainingAmount: totalPayable,
            paidAmount: 0,
            features: baseFeat,
          };
        });

        console.log(`Successfully formatted ${formattedLoans.length} loans`);
        setLoans(formattedLoans);
      } catch (err) {
        console.error('Error fetching loans:', err);
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch loans';
        setError(errorMsg);
        setLoans([]);
      } finally {
        setLoading(false);
      }
    };

    console.log('MyLoansPage useEffect triggered');
    
    // Fetch immediately on mount
    fetchLoans();

    // Set up 5-second refresh interval
    const interval = setInterval(() => {
      console.log('5-second auto-refresh triggered');
      fetchLoans();
    }, 5000);

    // Listen for visibility changes to refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('Page became visible, refreshing loans...');
        fetchLoans();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('🧹 Cleanup: removing interval and listener');
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [navigate, API_BASE_URL]);

  // Format backend status to frontend display format
  const formatStatus = (status: string): string => {
    const statusMap: { [key: string]: string } = {
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
      auto_rejected: "Auto Rejected",
      rejected: "Rejected",
      declined: "Rejected",
    };

    const normalized = String(status || "").toLowerCase();
    if (statusMap[normalized]) {
      return statusMap[normalized];
    }

    if (!status) {
      return "Under Review";
    }

    return status
      .toLowerCase()
      .split(/[_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Normalize loan type for display
  const normalizeLoanType = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      'personal': 'Personal',
      'home': 'Home',
      'auto': 'Auto',
      'education': 'Education',
      'business': 'Business',
      'credit_card': 'Credit Card'
    };
    return typeMap[type] || type;
  };

  // Fetch individual loan by ID
  const fetchLoanById = async (loanId: string) => {
    try {
      console.log(`Fetching loan details for ID: ${loanId}`);

      const response = await apiClient.get(`${API_BASE_URL}/loan/my-loans/${loanId}`);

      if (!response.ok) {
        console.error(`Failed to fetch loan (${response.status})`);
        return null;
      }

      const data = await response.json();
      console.log(`Loan details fetched:`, data.loan);

      return data.loan;
    } catch (err) {
      console.error('Error fetching loan details:', err);
      return null;
    }
  };

  // Handle loan card click - fetch fresh details by ID
  const handleLoanClick = async (loan: any) => {
    console.log(`Loan card clicked: ${loan.id}`);
    
    // First show the card data immediately for responsiveness
    setSelectedLoan(loan);
    
    // Then fetch fresh details by ID in background
    const freshLoan = await fetchLoanById(loan.id);
    if (freshLoan) {
      const backendStatus = freshLoan.status;
      const displayStatus = freshLoan.displayStatus || formatStatus(backendStatus);
      const isUnbankedFresh =
        freshLoan.applicantType === "unbanked" ||
        freshLoan.features?.underwritingPath === "unbanked";
      const headScoreFresh = freshLoan.aiAnalysis?.creditScore;
      let riskLevelFresh = freshLoan.aiAnalysis?.riskLevel || "medium";
      const baseFeatFresh = { ...(freshLoan.features || {}) };
      if (
        isUnbankedFresh &&
        headScoreFresh != null &&
        Number.isFinite(Number(headScoreFresh))
      ) {
        const s = Number(headScoreFresh);
        riskLevelFresh = alternateRiskLevelFromScore(s);
        baseFeatFresh.probabilityOfDefault = alternatePdFromBlendedCreditScore(s);
      }
      const formattedLoan = {
        ...freshLoan,
        id: freshLoan._id,
        loanId: freshLoan._id,
        amount: safeNumber(freshLoan.requestedAmount, 0),
        status: displayStatus,
        loanType: freshLoan.loanType,
        riskLevel: riskLevelFresh,
        interestRate: safeNumber(freshLoan.aiAnalysis?.suggestedInterestRate, 12.5),
        eligibleAmount: safeNumber(
          freshLoan.aiAnalysis?.eligibleAmount,
          freshLoan.requestedAmount
        ),
        creditScore: freshLoan.aiAnalysis?.creditScore,
        applicationDate: freshLoan.submittedAt ? new Date(freshLoan.submittedAt).toLocaleDateString() : 'N/A',
        tenure: Math.max(1, safeNumber(freshLoan.requestedTenure, 12)),
        category: normalizeLoanType(freshLoan.loanType),
        submittedAt: freshLoan.submittedAt,
        backendStatus,
        displayStatus,
        rejectionReason:
          freshLoan.adminDecision?.rejectionReason ||
          freshLoan.features?.decisionReason ||
          null,
        emi: Math.round(
          ((safeNumber(freshLoan.requestedAmount, 0) *
            (safeNumber(freshLoan.aiAnalysis?.suggestedInterestRate, 12.5) / 100 / 12) *
            Math.pow(
              1 + safeNumber(freshLoan.aiAnalysis?.suggestedInterestRate, 12.5) / 100 / 12,
              Math.max(1, safeNumber(freshLoan.requestedTenure, 12))
            )) /
            (Math.pow(
              1 + safeNumber(freshLoan.aiAnalysis?.suggestedInterestRate, 12.5) / 100 / 12,
              Math.max(1, safeNumber(freshLoan.requestedTenure, 12))
            ) -
              1)) || 0
        ),
        totalPayable:
          safeNumber(freshLoan.requestedAmount, 0) +
          Math.round(
            Math.max(1, safeNumber(freshLoan.requestedTenure, 12)) *
              (safeNumber(freshLoan.requestedAmount, 0) *
                (safeNumber(freshLoan.aiAnalysis?.suggestedInterestRate, 12.5) / 100 / 12))
          ),
        remainingAmount:
          safeNumber(freshLoan.requestedAmount, 0) +
          Math.round(
            Math.max(1, safeNumber(freshLoan.requestedTenure, 12)) *
              (safeNumber(freshLoan.requestedAmount, 0) *
                (safeNumber(freshLoan.aiAnalysis?.suggestedInterestRate, 12.5) / 100 / 12))
          ),
        paidAmount: 0,
        features: baseFeatFresh,
      };
      // Update with fresh data
      setSelectedLoan(formattedLoan);
      console.log(`Updated selected loan with fresh data`);
    }
  };

  const filteredLoans = filter === "All"
    ? loans
    : loans.filter((loan) => {
        const allowedStatuses = FILTER_STATUS_MAP[filter] || [];
        if (!allowedStatuses.length) {
          return true;
        }
        const normalizedBackendStatus = String(loan.backendStatus || loan.status || "").toLowerCase();
        if (allowedStatuses.includes(normalizedBackendStatus)) {
          return true;
        }
        return loan.status === filter;
      });

    const getStatusColor = (status: string) => {
    switch (status) {
      case "Approved":
        return "bg-green-400 text-black";
      case "Rejected":
      case "Auto Rejected":
        return "bg-red-400 text-black";
      case "Under Review":
        return "bg-yellow-300 text-black";
      case "Ongoing":
        return "bg-blue-400 text-black";
      case "Completed":
        return "bg-white text-black";
      default:
        return "bg-slate-100 text-black";
    }
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
              <button onClick={() => navigate("/apply-loan")} className="text-black/60 hover:text-black hover:opacity-100 transition-opacity text-[10px] md:text-xs font-black uppercase tracking-[0.2em]">Apply For Loan</button>
              <button className="text-blue-600 text-[10px] md:text-xs font-black uppercase tracking-[0.2em] border-b-[2px] border-blue-600 pb-[2px]">My Loans</button>
              <button onClick={() => navigate("/profile")} className="text-black/60 hover:text-black hover:opacity-100 transition-opacity text-[10px] md:text-xs font-black uppercase tracking-[0.2em]">Profile</button>
            </nav>
            <Button
              onClick={() => logout()}
              variant="outline"
              className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-[10px] md:text-xs px-6 py-2 uppercase tracking-[0.2em] transition-all"
            >
              Sign Out &rarr;
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[85%] w-full mx-auto py-12">
        
        {/* Sub Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
          <div>
            <h1 className="text-3xl md:text-5xl font-black text-black tracking-tighter uppercase leading-none">
              LOAN<br />
              <span className="text-blue-600">HISTORY.</span>
            </h1>
          </div>
          <Button onClick={() => navigate("/apply-loan")} className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.15em] px-8 h-12 transition-all group shrink-0">
            APPLY FOR LOAN <span className="ml-2 group-hover:translate-x-1 transition-transform">&rarr;</span>
          </Button>
        </div>

        {/* Filters */}
        {/* Filters */}
        <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
          {FILTER_OPTIONS.map((btn) => (
            <button
              key={btn}
              onClick={() => setFilter(btn)}
              className={`px-6 py-2.5 text-xs font-black tracking-[0.15em] uppercase border-[1.5px] transition-all whitespace-nowrap 
                ${filter === btn 
                  ? "bg-blue-600 text-white border-blue-600 shadow-[4px_4px_0_0_rgba(0,0,0,1)] -translate-y-0.5" 
                  : "bg-white border-black text-black hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)]"
              }`}
            >
              {btn}
            </button>
          ))}
        </div>

        {/* Loading State removed per user request */}

        {/* Error State */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error loading loans</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!error && filteredLoans.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 border-[1.5px] border-black p-12">
            <h3 className="text-2xl font-black text-black tracking-tighter uppercase">NO LOANS FOUND</h3>
            <p className="text-xs font-black tracking-[0.2em] text-black/50 uppercase max-w-sm">You haven't applied for any {filter !== 'All' ? filter.toLowerCase() : ''} loans yet.</p>
            <Button onClick={() => navigate("/apply-loan")} className="bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.2em] px-8 h-12 mt-4 transition-all">APPLY NOW &rarr;</Button>
          </div>
        )}

        {/* Loans Grid */}
        {!error && filteredLoans.length > 0 && (
        <div className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {filteredLoans.map((loan) => (
              <div 
                key={loan.id} 
                onClick={() => handleLoanClick(loan)}
                className="text-left group p-8 md:p-10 flex flex-col gap-5 bg-white border-[1.5px] border-black hover:-translate-y-1 hover:shadow-[6px_6px_0_0_rgba(0,0,0,1)] transition-all duration-300 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-serif text-blue-600 text-lg">₹</span>
                    <h3 className="font-black text-base md:text-lg uppercase tracking-tight text-black transition-colors duration-300">
                      {loan.category} LOAN
                    </h3>
                  </div>
                </div>
                
                <p className="text-[10px] md:text-xs text-black/40 font-bold tracking-widest uppercase transition-colors duration-300 leading-relaxed">
                  ₹{formatCurrency(loan.amount)} • STATUS: <span className={loan.status === 'Approved' ? 'text-green-600 font-black' : loan.status === 'Rejected' ? 'text-red-600 font-black' : loan.status === 'Ongoing' ? 'text-blue-600 font-black' : 'text-black/60 font-black'}>{loan.status}</span>
                </p>

                <div className="mt-auto pt-2 flex items-center text-[10px] md:text-xs font-black text-blue-600 uppercase tracking-[0.15em] group-hover:tracking-[0.2em] transition-all duration-300">
                  VIEW DETAILS <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform duration-300" />
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* Details Modal / Sidebar overlay */}
        {selectedLoan && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-white h-full border-l-[3px] border-black shadow-[-12px_0_0_0_rgba(0,0,0,0.1)] p-6 md:p-10 overflow-y-auto flex flex-col animate-in slide-in-from-right duration-300">
              
              {/* Top Close */}
              <div className="flex justify-between items-center pb-6 border-b-[1.5px] border-black">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-black tracking-[0.2em] uppercase">LOAN DETAILS</span>
                </div>
                <button onClick={() => setSelectedLoan(null)} className="p-2 hover:bg-black hover:text-white border-[1.5px] border-transparent hover:border-black rounded-none transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 space-y-6 pt-6">
                
                {/* ID & Status */}
                <div className="flex justify-between items-start pt-2">
                  <div>
                    <h3 className="text-3xl font-black text-black tracking-tighter uppercase mb-1">{selectedLoan.category}</h3>
                  </div>
                  <span className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-[1.5px] border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] ${getStatusColor(selectedLoan.status)}`}>
                    {selectedLoan.status}
                  </span>
                </div>

                {/* AI Risk Score */}
                {(selectedLoan.riskLevel || selectedLoan.creditScore) && (
                  <div className="flex flex-col gap-4 bg-white border-[1.5px] border-black p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)] group hover:border-blue-600 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase text-slate-500 tracking-widest">AI Risk Score</span>
                      <p className={`text-xs font-black uppercase px-3 py-1 border-[1.5px] border-black ${selectedLoan.riskLevel?.toLowerCase() === 'low' ? 'bg-green-400 text-black' :
                        selectedLoan.riskLevel?.toLowerCase() === 'medium' ? 'bg-yellow-400 text-black' :
                          'bg-red-500 text-white'
                        }`}>
                        {selectedLoan.riskLevel || 'UNKNOWN'} RISK
                      </p>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-6xl font-black text-black tracking-tighter leading-none group-hover:text-blue-600 transition-colors">{selectedLoan.creditScore || "N/A"}</p>
                      </div>
                      {selectedLoan.features?.probabilityOfDefault != null && (
                        <div className="text-right">
                          <p className="text-3xl font-black text-black tracking-tighter leading-none">{(selectedLoan.features.probabilityOfDefault * 100).toFixed(1)}<span className="text-xl">%</span></p>
                          <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mt-1">Default Prob</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Loan AI Details */}
                <div className="bg-white p-5 border-[1.5px] border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                  <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-4 border-b-[1.5px] border-black pb-2">Loan Details</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-end border-b border-black/10 pb-2">
                      <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Requested</span>
                      <span className="text-lg text-black font-black leading-none">₹{formatCurrency(selectedLoan.amount)}</span>
                    </div>
                    {selectedLoan.status !== "Rejected" && selectedLoan.status !== "Auto Rejected" && (
                      <>
                        <div className="flex justify-between items-end border-b border-black/10 pb-2">
                          <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Eligible</span>
                          <span className="text-xl text-blue-600 font-black leading-none">₹{formatCurrency(selectedLoan.eligibleAmount)}</span>
                        </div>
                        <div className="flex justify-between items-end border-b border-black/10 pb-2">
                          <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Suggested Rate</span>
                          <span className="text-lg text-black font-black leading-none">{selectedLoan.interestRate}% P.A.</span>
                        </div>
                        <div className="flex justify-between items-end border-b border-black/10 pb-2">
                          <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Tenure</span>
                          <span className="text-lg text-black font-black leading-none">{selectedLoan.tenure} MO</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Submitted Details */}
                <div className="bg-white p-5 border-[1.5px] border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                  <h3 className="text-xs font-black text-black uppercase tracking-[0.2em] mb-4 border-b-[1.5px] border-black pb-2">Submitted Details</h3>
                   <div className="space-y-3">
                    <div className="flex justify-between items-center border-[1.5px] border-black bg-slate-50 px-3 py-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Loan Type</span>
                      <span className="text-xs font-black text-black uppercase tracking-wider">{selectedLoan.loanType}</span>
                    </div>
                    <div className="flex justify-between items-center border-[1.5px] border-black bg-slate-50 px-3 py-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">App Date</span>
                      <span className="text-xs font-black text-black uppercase tracking-wider">{selectedLoan.applicationDate}</span>
                    </div>
                    <div className="flex justify-between items-center border-[1.5px] border-black bg-slate-50 px-3 py-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Purpose</span>
                      <span className="text-xs font-black text-black uppercase tracking-wider text-right pl-4 truncate max-w-[50%]">{selectedLoan.purpose || "N/A"}</span>
                    </div>
                  </div>
                </div>

                {/* User-facing decision explanation */}
                {selectedLoan.features?.userDecisionExplanation && (
                  <div className="bg-blue-50 p-5 border-[1.5px] border-blue-700 shadow-[4px_4px_0_0_rgba(37,99,235,0.35)]">
                    <h3 className="text-xs font-black text-blue-900 uppercase tracking-[0.2em] mb-3 border-b border-blue-300 pb-2">
                      {selectedLoan.features.userDecisionExplanation.title || "Decision explanation"}
                    </h3>
                    <p className="text-sm text-blue-900/90 font-semibold mb-3">
                      {selectedLoan.features.userDecisionExplanation.summary}
                    </p>
                    {Array.isArray(selectedLoan.features.userDecisionExplanation.reasons) &&
                      selectedLoan.features.userDecisionExplanation.reasons.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-blue-800 mb-1">Why</p>
                          {selectedLoan.features.userDecisionExplanation.reasons.map((reason: string, idx: number) => (
                            <p key={idx} className="text-xs text-blue-900 mb-1">- {reason}</p>
                          ))}
                        </div>
                      )}
                    {Array.isArray(selectedLoan.features.userDecisionExplanation.nextSteps) &&
                      selectedLoan.features.userDecisionExplanation.nextSteps.length > 0 && (
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-blue-800 mb-1">What to do next</p>
                          {selectedLoan.features.userDecisionExplanation.nextSteps.map((step: string, idx: number) => (
                            <p key={idx} className="text-xs text-blue-900 mb-1">- {step}</p>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                {/* Dynamic Configuration per Status */}
                
                {/* 1. ONGOING / APPROVED */}
                {(selectedLoan.status === "Ongoing" || selectedLoan.status === "Approved") && (
                  <>
                    <div className="bg-white border-[1.5px] border-black rounded-none p-6 space-y-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
                      {selectedLoan.status === "Ongoing" && (
                        <div>
                          <p className="text-[10px] font-black tracking-[0.2em] text-black/50 uppercase">REPAYMENT PROGRESS</p>
                          <div className="flex justify-between items-end mt-2 mb-3">
                            <span className="text-2xl font-black text-black tracking-tighter">₹{formatCurrency(selectedLoan.paidAmount)} <span className="text-xs font-black text-black/40 tracking-wider">PAID</span></span>
                            <span className="text-sm font-black text-blue-600">{Math.round((selectedLoan.paidAmount / selectedLoan.totalPayable) * 100)}%</span>
                          </div>
                          <div className="w-full h-3 bg-black/5 border-[1.5px] border-black overflow-hidden relative">
                            <div 
                              className="h-full bg-blue-600 transition-all duration-700 absolute left-0 top-0 border-r-[1.5px] border-black" 
                              style={{ width: `${(selectedLoan.paidAmount / selectedLoan.totalPayable) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-6 pt-2">
                        <div>
                          <p className="text-[10px] font-black tracking-[0.2em] text-black/50 uppercase">LOAN AMOUNT</p>
                          <p className="text-xl md:text-2xl font-black text-black tracking-tighter mt-1">₹{formatCurrency(selectedLoan.amount)}</p>
                        </div>
                        <div className="pl-6 border-l-[1.5px] border-black/10">
                          <p className="text-[10px] font-black tracking-[0.2em] text-black/50 uppercase">MONTHLY EMI</p>
                          <p className="text-xl md:text-2xl font-black text-blue-600 tracking-tighter mt-1">₹{formatCurrency(selectedLoan.emi)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 bg-white border-[1.5px] border-black rounded-none p-6 text-xs font-black tracking-wide uppercase">
                      <div className="flex justify-between items-center"><span className="text-black/50">START DATE</span><span className="text-black">{selectedLoan.startDate || "-"}</span></div>
                      <div className="flex justify-between items-center"><span className="text-black/50">TENURE</span><span className="text-black">{selectedLoan.tenure || "N/A"}</span></div>
                      <div className="flex justify-between items-center border-t-[1.5px] border-black/10 pt-4"><span className="text-black/50">INTEREST RATE</span><span className="text-black">{selectedLoan.interestRate}% P.A.</span></div>
                      <div className="flex justify-between items-center"><span className="text-black/50">TOTAL PAYABLE</span><span className="text-black">₹{formatCurrency(selectedLoan.totalPayable)}</span></div>
                      <div className="flex justify-between items-center"><span className="text-black/50">REMAINING BALANCE</span><span className="text-black">₹{formatCurrency(selectedLoan.remainingAmount)}</span></div>
                      <div className="flex justify-between items-center border-t-[1.5px] border-black/10 pt-4"><span className="text-black/50">NEXT DUE DATE</span><span className="text-green-600">{selectedLoan.nextDueDate}</span></div>
                      {selectedLoan.missedPayments > 0 && <div className="flex justify-between items-center"><span className="text-black/50">MISSED PAYMENTS</span><span className="text-red-600">{selectedLoan.missedPayments} TIMES</span></div>}
                    </div>

                    {selectedLoan.terms && (
                      <div className="bg-white border-[1.5px] border-black/20 rounded-none p-6">
                        <h5 className="text-[10px] font-black text-black uppercase tracking-[0.2em] mb-3 flex items-center gap-2"><Info className="w-4 h-4 text-blue-600" /> TERMS & CONDITIONS</h5>
                        <p className="text-xs text-black/60 font-medium leading-relaxed uppercase">{selectedLoan.terms}</p>
                      </div>
                    )}

                    {selectedLoan.status === "Ongoing" && (
                      <Button className="w-full bg-black text-white hover:bg-black/80 rounded-none border-[1.5px] border-transparent font-black text-xs uppercase tracking-[0.2em] h-14 transition-all hover:-translate-y-1 hover:shadow-[4px_4px_0_0_rgba(37,99,235,1)]">
                        PAY NEXT EMI &rarr;
                      </Button>
                    )}
                  </>
                )}

                {/* 2. REJECTED */}
                {(selectedLoan.status === "Rejected" || selectedLoan.status === "Auto Rejected") && (
                  <div className="space-y-6">
                    <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-4">
                      <Ban className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-base font-bold text-red-700">{selectedLoan.status === "Auto Rejected" ? "Automatically Rejected" : "Application Rejected"}</h4>
                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">Reason: {selectedLoan.rejectionReason || "No reason provided"}</p>
                      </div>
                    </div>
                    
                    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Requested Amount</span><span className="text-slate-900 font-semibold">₹{formatCurrency(selectedLoan.amount)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Application Date</span><span className="text-slate-900 font-semibold">{selectedLoan.applicationDate}</span></div>
                    </div>

                    <Button onClick={() => navigate("/apply-loan")} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 rounded-lg transition-all">
                      Apply Again
                    </Button>
                  </div>
                )}

                {/* 3. COMPLETED */}
                {selectedLoan.status === "Completed" && (
                  <div className="space-y-6">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-start gap-4">
                      <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-base font-bold text-green-700">Loan Fully Repaid</h4>
                        <p className="text-sm text-slate-600 mt-1">This loan has been closed on absolute terms without any outstanding dues.</p>
                      </div>
                    </div>

                    <div className="space-y-3 bg-white border border-slate-200 rounded-xl p-5">
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Original Amount</span><span className="text-slate-900 font-semibold">₹{formatCurrency(selectedLoan.amount)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Interest Rate</span><span className="text-slate-900 font-semibold">{selectedLoan.interestRate}% p.a.</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Start Date</span><span className="text-slate-900 font-semibold">{selectedLoan.startDate || "-"}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Close Date</span><span className="text-slate-900 font-semibold">{selectedLoan.endDate || "-"}</span></div>
                      <div className="flex justify-between text-sm border-t border-slate-200 pt-3"><span className="text-slate-600 font-medium">Tenure</span><span className="text-slate-900 font-semibold">{selectedLoan.tenure || "N/A"}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-600 font-medium">Total Magnitude Paid</span><span className="text-green-600 font-bold">₹{formatCurrency(selectedLoan.totalPayable)}</span></div>
                    </div>
                  </div>
                )}

              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}
