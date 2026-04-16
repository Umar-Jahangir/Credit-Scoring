import { CheckCircle, XCircle, AlertCircle, History } from "lucide-react";
import { Button } from "./ui/button";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { useState, useEffect } from "react";
import { apiClient } from "../services/apiClient";

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:8000/api';

export function AuditLog() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAuditLogs();
    
    const interval = setInterval(() => {
      fetchAuditLogs();
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchAuditLogs = async () => {
    try {
      const response = await apiClient.get(`${API_BASE_URL}/admin/audit-logs`);
      
      if (response.ok) {
        const data = await response.json();
        const logs = (data.logs || []).map((log: any) => ({
          id: log._id,
          applicantName: log.applicantName || 'Unknown',
          eventType: log.eventType,
          description: log.description,
          timestamp: new Date(log.timestamp).toLocaleString('en-IN'),
          severity: log.severity || 'info',
          icon: log.severity === 'success' ? CheckCircle : log.severity === 'error' ? XCircle : AlertCircle
        }));
        setAuditLogs(logs);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventColor = (severity: string) => {
    switch (severity) {
      case "success":
        return "bg-green-500/10 border-green-500/20 text-green-300";
      case "error":
        return "bg-red-500/10 border-red-500/20 text-red-300";
      case "warning":
        return "bg-yellow-500/10 border-yellow-500/20 text-yellow-300";
      default:
        return "bg-gray-500/10 border-gray-500/20 text-gray-300";
    }
  };

  const getTextColor = (severity: string) => {
    switch (severity) {
      case "success":
        return "text-green-400";
      case "error":
        return "text-red-400";
      case "warning":
        return "text-yellow-400";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white">
      <style>{`
        html {
          scrollbar-gutter: stable;
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
              <button onClick={() => navigate("/admin/loans")} className="text-slate-900 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-600 transition-all pb-1.5 border-b-[3px] border-transparent hover:border-blue-600">Loans</button>
              <button onClick={() => navigate("/admin/reports")} className="text-blue-600 font-black uppercase tracking-[0.15em] text-xs hover:text-blue-700 transition-all pb-1.5 border-b-[3px] border-blue-600">Audit Log</button>
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
      <main className="w-full px-6 sm:px-8 md:px-12 lg:px-16 py-12 flex-1 overflow-y-auto bg-[#fafafa]">
        <div className="max-w-[1400px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="mb-14">
            <div className="flex items-center gap-4 mb-3">
              {/* <div className="w-12 h-12 bg-blue-600 flex items-center justify-center rounded-sm">
                <History className="w-6 h-6 text-white" />
              </div> */}
              <h1 className="text-5xl md:text-6xl font-black text-black tracking-tighter uppercase">AUDIT LOG</h1>
            </div>
            <p className="text-black/50 font-black uppercase tracking-[0.15em] text-xs">Track all application activities and administrative actions</p>
          </div>

          {/* Audit Log Table */}
          <div className="bg-white border border-slate-200 rounded-sm overflow-hidden shadow-sm">
            <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
              <div className="space-y-0 divide-y divide-slate-200">
                {auditLogs.map((log) => (
                  <div key={log.id} className="hover:bg-blue-50/50 transition-colors duration-200">
                    <div className="px-8 py-6">
                      <div className="flex items-start gap-6">
                        {/* Icon */}
                        <div className={`flex-shrink-0 mt-1 ${getEventColor(log.severity)} p-3 border rounded-sm`}>
                          <log.icon className={`w-5 h-5 ${getTextColor(log.severity)}`} strokeWidth={2.5} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-4 mb-2">
                            <div className="flex-1">
                              <p className="text-sm font-black text-black uppercase tracking-wider">{log.applicantName}</p>
                              <p className={`text-[10px] font-black uppercase tracking-[0.15em] mt-1.5 ${getTextColor(log.severity)}`}>
                                {log.eventType}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">{log.timestamp}</p>
                            </div>
                          </div>
                          <p className="text-[11px] text-black font-black uppercase tracking-[0.15em] mt-2">
                            {log.description.replace(/\s*by\s+.*?Admin$/i, '')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
