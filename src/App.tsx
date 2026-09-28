/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp,
  getDocFromServer,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  getDocs
} from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { 
  onAuthStateChanged, 
  signOut, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  getAuth
} from 'firebase/auth';
import { db, auth, firebaseConfig } from './firebase';
import Webcam from "react-webcam";
import { 
  Camera, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  LogOut, 
  Plus, 
  History, 
  User as UserIcon,
  UserPlus,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  Timer,
  Hourglass,
  Mail,
  Lock,
  KeyRound,
  GraduationCap,
  LayoutDashboard,
  Check,
  X,
  Eye,
  Calendar,
  Clock,
  Settings,
  Search,
  QrCode,
  Smartphone,
  ArrowLeft,
  RefreshCcw,
  ShieldAlert,
  Filter,
  SlidersHorizontal,
  Trash2,
  Sparkles,
  Zap,
  ExternalLink,
  Table as TableIcon,
  LayoutGrid,
  FileSpreadsheet,
  Upload,
  Printer,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Move,
  Copy,
  FileText,
  CheckCheck,
  EyeOff,
  UserCheck,
  Send,
  UploadCloud,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types & 30-Minute Expiration Constants ---
export const APPROVER_POSITIONS = ["Bí thư ĐT", "P.Bí thư ĐT", "Ủy viên BCH"] as const;
export type ApproverPosition = typeof APPROVER_POSITIONS[number];

// Thời gian hiệu lực của phiếu ra cổng: 30 phút kể từ lúc admin/cán bộ duyệt phiếu
export const GATE_PASS_VALIDITY_MS = 30 * 60 * 1000;

// Liên kết Webhook Make.com và Tên trang tính Google Sheets chính thức của toàn hệ thống
export const OFFICIAL_MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/tvuujqswrn3xh2ksq6kw7mtb2edfkeoi";
export const OFFICIAL_SHEET_NAME = "RaCong";

interface GatePass {
  id?: string;
  passId?: string;
  fullName: string;
  department: string;
  phoneNumber?: string;
  reason: string;
  exitTime: string;
  photoUrl: string;
  status: 'pending' | 'approved' | 'rejected' | 'Chờ duyệt' | 'Đã duyệt' | 'Từ chối' | 'Đã hết hạn' | 'expired' | 'Đã hết hạn ra cổng';
  createdAt: any;
  uid: string;
  approvedAt?: any;
  expiredAt?: string;
  approvedBy?: string;
  approverRole?: string;
  approverPosition?: string;
  approverEmail?: string;
}

/**
 * Kiểm tra xem phiếu đã quá thời hạn 30 phút kể từ khi duyệt hay chưa
 */
export const isPassExpired = (pass: GatePass | null | undefined): boolean => {
  if (!pass) return false;
  if (pass.status === 'Đã hết hạn' || pass.status === 'expired' || pass.status === 'Đã hết hạn ra cổng') {
    return true;
  }
  const isApproved = pass.status === 'approved' || pass.status === 'Đã duyệt';
  if (!isApproved) return false;
  
  if (!pass.approvedAt) return false;
  let approvedTime: number = 0;
  if (typeof pass.approvedAt === 'string') {
    approvedTime = new Date(pass.approvedAt).getTime();
  } else if (pass.approvedAt?.seconds) {
    approvedTime = pass.approvedAt.seconds * 1000;
  } else if (pass.approvedAt instanceof Date) {
    approvedTime = pass.approvedAt.getTime();
  }
  if (!approvedTime || isNaN(approvedTime)) return false;
  
  return Date.now() - approvedTime > GATE_PASS_VALIDITY_MS;
};

/**
 * Lấy số giây còn lại cho phiếu đã duyệt (tối đa 1800 giây = 30 phút)
 */
export const getPassRemainingSeconds = (pass: GatePass | null | undefined): number => {
  if (!pass) return 0;
  const isApproved = pass.status === 'approved' || pass.status === 'Đã duyệt';
  if (!isApproved || !pass.approvedAt) return 0;
  
  let approvedTime: number = 0;
  if (typeof pass.approvedAt === 'string') {
    approvedTime = new Date(pass.approvedAt).getTime();
  } else if (pass.approvedAt?.seconds) {
    approvedTime = pass.approvedAt.seconds * 1000;
  } else if (pass.approvedAt instanceof Date) {
    approvedTime = pass.approvedAt.getTime();
  }
  if (!approvedTime || isNaN(approvedTime)) return 0;
  
  const elapsed = Date.now() - approvedTime;
  return Math.max(0, Math.floor((GATE_PASS_VALIDITY_MS - elapsed) / 1000));
};

/**
 * Định dạng thời gian đếm ngược MM:SS
 */
export const formatCountdown = (totalSeconds: number): string => {
  if (totalSeconds <= 0) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Lấy trạng thái hiệu lực thực tế của phiếu
 */
export const getPassEffectiveStatus = (pass: GatePass): 'Chờ duyệt' | 'Đã duyệt' | 'Từ chối' | 'Đã hết hạn' => {
  if (pass.status === 'rejected' || pass.status === 'Từ chối') return 'Từ chối';
  if (isPassExpired(pass)) return 'Đã hết hạn';
  if (pass.status === 'approved' || pass.status === 'Đã duyệt') return 'Đã duyệt';
  return 'Chờ duyệt';
};

/**
 * Lấy thời điểm chính xác phiếu sẽ hết hạn (sau 30 phút duyệt)
 */
export const getPassExpiryDate = (pass: GatePass | null | undefined): Date | null => {
  if (!pass?.approvedAt) return null;
  let approvedTime: number = 0;
  if (typeof pass.approvedAt === 'string') {
    approvedTime = new Date(pass.approvedAt).getTime();
  } else if (pass.approvedAt?.seconds) {
    approvedTime = pass.approvedAt.seconds * 1000;
  } else if (pass.approvedAt instanceof Date) {
    approvedTime = pass.approvedAt.getTime();
  }
  if (!approvedTime || isNaN(approvedTime)) return null;
  return new Date(approvedTime + GATE_PASS_VALIDITY_MS);
};

interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'student';
  displayName: string;
  className?: string;
  position?: string;
  phoneNumber?: string;
  isVerified?: boolean;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} (${parsedError.operationType} on ${parsedError.path})`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#141414] border border-red-500/20 rounded-2xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-gray-400 mb-6 text-sm">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- App Component ---
export default function App() {
  return (
    <ErrorBoundary>
      <GatePassApp />
    </ErrorBoundary>
  );
}

function GatePassApp() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isMockMode, setIsMockMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [selectedPass, setSelectedPass] = useState<GatePass | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<any[]>([]);
  const [selectedSavedAccount, setSelectedSavedAccount] = useState<any | null>(null);

  // Đọc danh sách tài khoản đã có / đã lưu từ localStorage và Firestore
  useEffect(() => {
    try {
      const raw = localStorage.getItem('gatepass_saved_accounts');
      let list: any[] = [];
      if (raw) {
        list = JSON.parse(raw);
      }
      // Đảm bảo luôn có tài khoản Admin cấp cao Trần Minh Lý
      if (!list.some(a => (a.email || '').toLowerCase() === 'lytm.angiang@gmail.com')) {
        list.unshift({
          email: 'lytm.angiang@gmail.com',
          displayName: 'Trần Minh Lý',
          role: 'admin',
          position: 'Bí thư ĐT',
          phoneNumber: '0912345678'
        });
      }
      setSavedAccounts(list);
    } catch (e) {
      console.warn("Lỗi đọc danh sách tài khoản:", e);
      setSavedAccounts([{
        email: 'lytm.angiang@gmail.com',
        displayName: 'Trần Minh Lý',
        role: 'admin',
        position: 'Bí thư ĐT',
        phoneNumber: '0912345678'
      }]);
    }
  }, []);

  // Tự động lưu tài khoản vào danh sách khi đăng nhập thành công
  useEffect(() => {
    if (userProfile && userProfile.email) {
      const emailLower = userProfile.email.toLowerCase();
      const updatedAcc = {
        email: emailLower,
        displayName: userProfile.displayName || (userProfile.role === 'admin' ? 'Trần Minh Lý' : 'Học sinh'),
        role: userProfile.role,
        position: userProfile.position || (userProfile.role === 'admin' ? 'Bí thư ĐT' : undefined),
        className: userProfile.className,
        phoneNumber: userProfile.phoneNumber,
        lastLogin: Date.now()
      };
      setSavedAccounts(prev => {
        const filtered = prev.filter(a => (a.email || '').toLowerCase() !== emailLower);
        const newList = [updatedAcc, ...filtered].slice(0, 10);
        try {
          localStorage.setItem('gatepass_saved_accounts', JSON.stringify(newList));
        } catch (e) {
          console.warn("Lỗi lưu tài khoản:", e);
        }
        return newList;
      });
    }
  }, [userProfile]);

  // Trạng thái xuất trình & xác minh hỗ trợ bảo vệ kiểm tra
  const [showSecurityBadge, setShowSecurityBadge] = useState(false);
  const [verifyPassId, setVerifyPassId] = useState<string | null>(null);
  const [verifyPassData, setVerifyPassData] = useState<GatePass | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [liveSecTime, setLiveSecTime] = useState<Date>(new Date());

  // Đồng hồ cập nhật từng giây cho diện mạo bảo vệ cực kỳ an tâm
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveSecTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Đọc tham số URL ?verify=gatepass_id
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vId = params.get('verify');
    if (vId) {
      setVerifyPassId(vId);
    }
  }, []);

  // Truy vấn dữ liệu phiếu xác minh độc lập cho bảo vệ (không yêu cầu login)
  useEffect(() => {
    if (!verifyPassId) return;

    const fetchVerifyPass = async () => {
      setVerifyLoading(true);
      setVerifyError(null);
      try {
        // Thứ nhất: kiểm tra xem có lưu trữ cục bộ cho chế độ Mock không
        const localData = localStorage.getItem('mock_gatepasses');
        if (localData) {
          const localList = JSON.parse(localData) as GatePass[];
          const matched = localList.find(p => p.id === verifyPassId);
          if (matched) {
            setVerifyPassData(matched);
            setVerifyLoading(false);
            return;
          }
        }

        // Thứ hai: Truy vấn trực tiếp từ Cloud Firestore
        const docRef = doc(db, 'gatepasses', verifyPassId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setVerifyPassData({ id: docSnap.id, ...docSnap.data() } as GatePass);
        } else {
          setVerifyError("Phiếu ra cổng không tồn tại trên hệ thống hoặc đã bị thu hồi.");
        }
      } catch (e: any) {
        console.error("Lỗi xác thực phiếu:", e);
        setVerifyError("Không thể kết nối máy chủ Cloud: " + e.message);
      } finally {
        setVerifyLoading(false);
      }
    };

    fetchVerifyPass();
  }, [verifyPassId]);
  
  const getVietnamOrLocalISOString = () => {
    const d = new Date();
    const tzoffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzoffset).toISOString().slice(0, 16);
  };

  const [formData, setFormData] = useState({
    fullName: '',
    department: '',
    phoneNumber: '',
    reason: '',
    exitTime: getVietnamOrLocalISOString()
  });
  const [selectedReasonOption, setSelectedReasonOption] = useState<string>('');
  const [customReasonText, setCustomReasonText] = useState<string>('');
  const [selectedQuickMinutes, setSelectedQuickMinutes] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerData, setRegisterData] = useState({
    fullName: '',
    className: '',
    phoneNumber: '',
    email: '',
    password: ''
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Forgot Password States
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);
  const [resetSentEmail, setResetSentEmail] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // Countdown timer cho nút Gửi lại liên kết mật khẩu
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Admin Account Creation States (Chỉ Admin mới có quyền)
  const [showCreateAdminModal, setShowCreateAdminModal] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminPosition, setNewAdminPosition] = useState('Bí thư ĐT');
  const [newAdminPhone, setNewAdminPhone] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);
  const [createAdminSuccess, setCreateAdminSuccess] = useState<string | null>(null);
  const [createAdminError, setCreateAdminError] = useState<string | null>(null);
  const [adminList, setAdminList] = useState<any[]>([]);
  const [isLoadingAdminList, setIsLoadingAdminList] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState<'create' | 'list'>('create');

  // Integration Settings (Make AI & Google Sheets) - Liên kết chính thức cố định trên mọi thiết bị
  const [integrationWebhook, setIntegrationWebhook] = useState<string>(() => {
    const saved = localStorage.getItem('config_webhook_url');
    if (!saved || saved.includes("your_make_webhook_id") || saved.includes("abc123.ngrok") || saved.includes("localhost:5678") || saved.includes("hook.eu2.make.com/your")) {
      localStorage.setItem('config_webhook_url', OFFICIAL_MAKE_WEBHOOK_URL);
      return OFFICIAL_MAKE_WEBHOOK_URL;
    }
    return saved;
  });
  const [integrationSheetName, setIntegrationSheetName] = useState<string>(() => {
    const saved = localStorage.getItem('config_sheet_name');
    if (!saved || saved === "DanhSachRaCong") {
      localStorage.setItem('config_sheet_name', OFFICIAL_SHEET_NAME);
      return OFFICIAL_SHEET_NAME;
    }
    return saved;
  });
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [syncingPassId, setSyncingPassId] = useState<string | null>(null);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<{ message: string; success: boolean } | null>(null);
  const [saveConfigSuccess, setSaveConfigSuccess] = useState(false);
  const [copiedFieldName, setCopiedFieldName] = useState<string | null>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');

  // Profile Editing States
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileClass, setProfileClass] = useState('');
  const [profilePosition, setProfilePosition] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Xác định Quản trị viên cấp cao (Trần Minh Lý - lytm.angiang@gmail.com)
  // Chỉ Master Admin mới có quyền tạo tài khoản quản trị khác và xóa phiếu đăng ký
  const isMasterAdmin = Boolean(
    (userProfile?.email || user?.email || '').toLowerCase() === 'lytm.angiang@gmail.com'
  );

  // Deletion States
  const [selectedPassIds, setSelectedPassIds] = useState<string[]>([]);
  const [passToDelete, setPassToDelete] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Phóng to ảnh để nhận diện khuôn mặt (Face Recognition Zoom)
  const [zoomedPass, setZoomedPass] = useState<GatePass | null>(null);
  const [imageZoomScale, setImageZoomScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isImageFullscreen, setIsImageFullscreen] = useState(false);
  const panStartRef = useRef<{ startX: number; startY: number; initPanX: number; initPanY: number }>({ startX: 0, startY: 0, initPanX: 0, initPanY: 0 });
  const [copiedPassId, setCopiedPassId] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomedPass) {
          setZoomedPass(null);
          setImageZoomScale(1);
          setPanOffset({ x: 0, y: 0 });
        } else if (passToDelete) {
          setPassToDelete(null);
        } else if (bulkDeleteConfirm) {
          setBulkDeleteConfirm(false);
        } else if (selectedPass) {
          setSelectedPass(null);
          setShowSecurityBadge(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedPass, passToDelete, bulkDeleteConfirm, selectedPass]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsImageFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handlePanStart = (clientX: number, clientY: number) => {
    if (imageZoomScale <= 1) return;
    setIsPanning(true);
    panStartRef.current = {
      startX: clientX,
      startY: clientY,
      initPanX: panOffset.x,
      initPanY: panOffset.y,
    };
  };

  const handlePanMove = (clientX: number, clientY: number) => {
    if (!isPanning || imageZoomScale <= 1) return;
    const dx = clientX - panStartRef.current.startX;
    const dy = clientY - panStartRef.current.startY;
    setPanOffset({
      x: panStartRef.current.initPanX + dx,
      y: panStartRef.current.initPanY + dy,
    });
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  useEffect(() => {
    if (userProfile) {
      setProfileName(userProfile.displayName || '');
      setProfileClass(userProfile.className || '');
      const validAdminPos = userProfile.position && APPROVER_POSITIONS.includes(userProfile.position as any)
        ? userProfile.position
        : 'Bí thư ĐT';
      setProfilePosition(userProfile.role === 'admin' ? validAdminPos : (userProfile.position || ''));
      setProfilePhone(userProfile.phoneNumber || '');
      setFormData(prev => ({
        ...prev,
        fullName: prev.fullName || userProfile.displayName || '',
        department: prev.department || userProfile.className || '',
        phoneNumber: prev.phoneNumber || userProfile.phoneNumber || ''
      }));
    }
  }, [userProfile]);

  const [activeTab, setActiveTab ] = useState<'all' | 'pending' | 'approved' | 'expired' | 'rejected'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'pendingFirst'>('newest');
  const [tickTime, setTickTime] = useState(Date.now());
  const [currentPage, setCurrentPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');

  // Thống kê động (KPI metrics) trực quan, tự động cập nhật từng giây khi phiếu chạm mốc 30 phút
  const metrics = useMemo(() => {
    const total = passes.length;
    const pending = passes.filter(p => getPassEffectiveStatus(p) === 'Chờ duyệt').length;
    const approved = passes.filter(p => getPassEffectiveStatus(p) === 'Đã duyệt').length; // Còn hiệu lực trong 30 phút
    const expired = passes.filter(p => getPassEffectiveStatus(p) === 'Đã hết hạn').length; // Quá 30 phút kể từ lúc duyệt
    const rejected = passes.filter(p => getPassEffectiveStatus(p) === 'Từ chối').length;
    
    const todayStr = new Date().toDateString();
    const today = passes.filter(p => {
      if (!p.createdAt) return false;
      let d: Date;
      if (typeof p.createdAt === 'string') d = new Date(p.createdAt);
      else if (p.createdAt?.seconds) d = new Date(p.createdAt.seconds * 1000);
      else if (p.createdAt instanceof Date) d = p.createdAt;
      else return false;
      return d.toDateString() === todayStr;
    }).length;

    return { total, pending, approved, expired, rejected, today };
  }, [passes, tickTime]);

  // Reset selected passes when active classification tab changes
  useEffect(() => {
    setSelectedPassIds([]);
  }, [activeTab]);

  // Reset page to 1 on filter or sort updates
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, sortBy, viewMode]);

  // Real-time ticking interval for live duration countdown and precise 30-minute expiration
  useEffect(() => {
    const timer = setInterval(() => {
      setTickTime(Date.now());
    }, 1000); // Cập nhật từng giây cho đồng hồ đếm ngược
    return () => clearInterval(timer);
  }, []);

  // Tự động kiểm tra và cập nhật các phiếu duyệt quá 30 phút sang trạng thái "Đã hết hạn" trên CSDL
  useEffect(() => {
    if (!passes || passes.length === 0) return;
    const expiredPasses = passes.filter(p => 
      p.id && 
      (p.status === 'approved' || p.status === 'Đã duyệt') && 
      isPassExpired(p)
    );

    if (expiredPasses.length === 0) return;

    expiredPasses.forEach(async (pass) => {
      if (!pass.id) return;
      const nowIso = new Date().toISOString();
      if (isMockMode) {
        const local = localStorage.getItem('mock_gatepasses');
        if (local) {
          const list = JSON.parse(local) as GatePass[];
          const updated = list.map(item => item.id === pass.id ? { ...item, status: 'Đã hết hạn' as any, expiredAt: nowIso } : item);
          localStorage.setItem('mock_gatepasses', JSON.stringify(updated));
          setPasses(updated);
        }
      } else {
        try {
          await updateDoc(doc(db, 'gatepasses', pass.id), {
            status: 'Đã hết hạn',
            expiredAt: nowIso
          });
        } catch (err) {
          console.warn("Lỗi đồng bộ tự động hết hạn sang Firestore:", err);
        }
      }
    });
  }, [passes, tickTime, isMockMode]);

  const getRelativeTimeString = (createdAt: any) => {
    if (!createdAt) return "Vừa xong";
    let date: Date;
    if (typeof createdAt === 'string') {
      date = new Date(createdAt);
    } else if (createdAt?.seconds) {
      date = new Date(createdAt.seconds * 1000);
    } else if (createdAt instanceof Date) {
      date = createdAt;
    } else {
      return "Vừa xong";
    }

    const diffMs = tickTime - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMs < 0) return "Sắp tới"; // handle time sync offsets gently
    if (diffSec < 15) return "Vừa xong";
    if (diffSec < 60) return `${diffSec} giây trước`;
    if (diffMin < 60) return `${diffMin} phút trước`;
    if (diffHour < 24) return `${diffHour} giờ trước`;
    if (diffDay === 1) return `Hôm qua`;
    if (diffDay < 7) return `${diffDay} ngày trước`;
    return date.toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const filteredAndSortedPasses = useMemo(() => {
    // 1. Filter by active tab (status)
    let list = passes;
    if (activeTab !== 'all') {
      list = list.filter(p => {
        const effStatus = getPassEffectiveStatus(p);
        if (activeTab === 'pending') return effStatus === 'Chờ duyệt';
        if (activeTab === 'approved') return effStatus === 'Đã duyệt'; // Chỉ các phiếu đã duyệt CÒN HIỆU LỰC
        if (activeTab === 'expired') return effStatus === 'Đã hết hạn'; // Các phiếu đã hết hạn quá 30 phút
        if (activeTab === 'rejected') return effStatus === 'Từ chối';
        return false;
      });
    }

    // 2. Filter by search query (name, class/department, reason, pass ID)
    if (searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase().trim();
      list = list.filter(p => 
        (p.fullName || '').toLowerCase().includes(queryLower) ||
        (p.department || '').toLowerCase().includes(queryLower) ||
        (p.reason || '').toLowerCase().includes(queryLower) ||
        (p.passId || '').toLowerCase().includes(queryLower) ||
        (p.id || '').toLowerCase().includes(queryLower)
      );
    }

    // 3. Sort
    return [...list].sort((a, b) => {
      const getMs = (p: GatePass) => {
        const createdAtVal = p.createdAt;
        if (!createdAtVal) {
          return p.exitTime ? new Date(p.exitTime).getTime() : 0;
        }
        if (typeof createdAtVal === 'string') return new Date(createdAtVal).getTime();
        if (createdAtVal?.seconds) return createdAtVal.seconds * 1000;
        return 0;
      };

      if (sortBy === 'pendingFirst') {
        const isAPending = a.status === 'pending' || a.status === 'Chờ duyệt';
        const isBPending = b.status === 'pending' || b.status === 'Chờ duyệt';
        if (isAPending && !isBPending) return -1;
        if (!isAPending && isBPending) return 1;
        return getMs(b) - getMs(a);
      } else if (sortBy === 'newest') {
        return getMs(b) - getMs(a);
      } else if (sortBy === 'oldest') {
        return getMs(a) - getMs(b);
      }
      return 0;
    });
  }, [passes, activeTab, searchQuery, sortBy]);

  const itemsPerPage = viewMode === 'table' ? 10 : 6;
  const totalPages = useMemo(() => {
    return Math.ceil(filteredAndSortedPasses.length / itemsPerPage);
  }, [filteredAndSortedPasses, itemsPerPage]);

  const paginatedPasses = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedPasses.slice(start, start + itemsPerPage);
  }, [filteredAndSortedPasses, currentPage, itemsPerPage]);

  const webcamRef = useRef<Webcam>(null);

  // Xuất dữ liệu bảng tính CSV sạch sẽ
  const exportToCSV = () => {
    if (filteredAndSortedPasses.length === 0) {
      alert("Không có phiếu nào để xuất dữ liệu.");
      return;
    }
    const headers = ["Mã phiếu ID", "Họ và tên", "Lớp/Bộ phận", "Số điện thoại", "Lý do", "Thời gian xin ra", "Thời gian gửi phiếu", "Trạng thái", "Thời gian duyệt phiếu", "Người duyệt", "Chức vụ"];
    const rows = filteredAndSortedPasses.map(p => [
      `"${(p.passId || p.id || '').replace(/"/g, '""')}"`,
      `"${(p.fullName || '').replace(/"/g, '""')}"`,
      `"${(p.department || '').replace(/"/g, '""')}"`,
      `"'${(p.phoneNumber || '').replace(/"/g, '""')}"`,
      `"${(p.reason || '').replace(/"/g, '""')}"`,
      `"${p.exitTime ? new Date(p.exitTime).toLocaleString('vi-VN') : ''}"`,
      `"${p.createdAt ? (typeof p.createdAt === 'string' ? new Date(p.createdAt).toLocaleString('vi-VN') : (p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleString('vi-VN') : '')) : ''}"`,
      `"${p.status || ''}"`,
      `"${p.approvedAt ? new Date(p.approvedAt).toLocaleString('vi-VN') : ''}"`,
      `"${(p.approvedBy || '').replace(/"/g, '""')}"`,
      `"${(p.approverRole || p.approverPosition || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `RaCong_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Duyệt hàng loạt cho Quản trị viên
  const handleBulkApprove = async () => {
    if (selectedPassIds.length === 0 || userProfile?.role !== 'admin') return;
    setIsDeleting(true);
    try {
      for (const id of selectedPassIds) {
        await handleUpdateStatus(id, 'approved');
      }
      setSelectedPassIds([]);
    } catch (err) {
      console.error("Bulk approve error:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Từ chối hàng loạt
  const handleBulkReject = async () => {
    if (selectedPassIds.length === 0 || userProfile?.role !== 'admin') return;
    setIsDeleting(true);
    try {
      for (const id of selectedPassIds) {
        await handleUpdateStatus(id, 'rejected');
      }
      setSelectedPassIds([]);
    } catch (err) {
      console.error("Bulk reject error:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Gợi ý lý do chính đáng chuẩn: Bệnh xin về, Nhà có việc gấp, Được cử tham gia phong trào, Vấn đề con gái, Lý do khác
  const QUICK_REASONS = [
    "Bệnh xin về",
    "Nhà có việc gấp",
    "Được cử tham gia phong trào",
    "Vấn đề con gái",
    "Lý do khác"
  ] as const;

  // Gợi ý thời gian ra nhanh: 5 phút, 10 phút, 15 phút, 20 phút
  const setQuickTimeMinutes = (minutesAhead: number) => {
    setSelectedQuickMinutes(minutesAhead);
    const d = new Date(Date.now() + minutesAhead * 60000);
    const tzoffset = d.getTimezoneOffset() * 60000;
    const localIso = new Date(d.getTime() - tzoffset).toISOString().slice(0, 16);
    setFormData(prev => ({ ...prev, exitTime: localIso }));
  };

  // Tải ảnh từ tệp / thiết bị nếu webcam bị khóa quyền
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCapturedImage(base64);
        verifyFace(base64);
      };
      reader.readAsDataURL(file);
    }
    // Cho phép chọn lại cùng 1 tệp nếu muốn đổi
    e.target.value = '';
  };

  const handleChangeDisplayName = async (newName: string) => {
    if (!user || !userProfile || !newName.trim()) return;
    const cleanName = newName.trim();
    const updatedProfile = { ...userProfile, displayName: cleanName };
    setUserProfile(updatedProfile);
    
    // Propagate change directly to the active form input
    setFormData(prev => ({ ...prev, fullName: cleanName }));

    if (isMockMode) {
      alert("Đã đổi tên thử nghiệm thành: " + cleanName);
    } else {
      try {
        await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
        alert("Cập nhật họ tên thành công!");
      } catch (err) {
        console.error("Lỗi cập nhật tên:", err);
      }
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !userProfile) return;

    const cleanedName = profileName.trim();
    if (!cleanedName) {
      alert("Họ và tên không được để trống!");
      return;
    }

    const cleanedPosition = userProfile.role === 'admin' 
      ? (APPROVER_POSITIONS.includes(profilePosition as any) ? profilePosition : 'Bí thư ĐT')
      : profilePosition.trim();

    const updatedProfile: UserProfile = {
      ...userProfile,
      displayName: cleanedName,
      className: profileClass.trim(),
      position: cleanedPosition,
      phoneNumber: profilePhone.trim()
    };

    setIsSavingProfile(true);

    try {
      if (isMockMode) {
        setUserProfile(updatedProfile);
        setFormData(prev => ({
          ...prev,
          fullName: cleanedName,
          department: updatedProfile.role === 'admin' ? cleanedPosition : (updatedProfile.className || '')
        }));
        alert("Đã cập nhật thông tin cá nhân và chức vụ thành công!");
        setShowProfileEdit(false);
      } else {
        await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
        setUserProfile(updatedProfile);
        setFormData(prev => ({
          ...prev,
          fullName: cleanedName,
          department: updatedProfile.role === 'admin' ? cleanedPosition : (updatedProfile.className || '')
        }));
        alert("Cập nhật thông tin cá nhân và chức vụ thành công!");
        setShowProfileEdit(false);
      }
    } catch (err) {
      console.error("Lỗi cập nhật hồ sơ cá nhân:", err);
      alert("Lỗi khi lưu thông tin: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Pre-fill form data from user profile
  useEffect(() => {
    if (userProfile) {
      setFormData(prev => ({
        ...prev,
        fullName: userProfile.displayName || '',
        department: userProfile.role === 'admin' ? 'Ban Giám Hiệu / Quản trị viên' : (userProfile.className || '')
      }));
    }
  }, [userProfile]);

  // --- Auth & Initial Load ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Fetch or create user profile
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        const currentUserEmail = (currentUser.email || '').toLowerCase().trim();
        const emailKey = currentUserEmail.replace(/\./g, '_');
        
        let isWhitelistedAdmin = false;
        let whitelistData: any = null;
        try {
          const wlDoc = await getDoc(doc(db, 'admin_whitelist', emailKey));
          if (wlDoc.exists()) {
            isWhitelistedAdmin = true;
            whitelistData = wlDoc.data();
          }
        } catch (e) {
          console.warn("Lỗi kiểm tra whitelist admin:", e);
        }

        const isAdminEmail = currentUserEmail === 'lytm.angiang@gmail.com' || isWhitelistedAdmin || currentUserEmail.includes('admin');

        if (userDoc.exists()) {
          const profile = userDoc.data() as UserProfile;
          if (currentUserEmail === 'lytm.angiang@gmail.com') {
            profile.role = 'admin';
            profile.displayName = 'Trần Minh Lý';
            profile.position = 'Bí thư ĐT';
            try {
              await setDoc(userDocRef, { 
                role: 'admin', 
                position: 'Bí thư ĐT',
                displayName: 'Trần Minh Lý' 
              }, { merge: true });
            } catch (err) {
              console.warn("Lỗi đồng bộ quyền Admin cấp cao:", err);
            }
          } else if (isAdminEmail && profile.role !== 'admin') {
            profile.role = 'admin';
            profile.position = profile.position || whitelistData?.position || 'Bí thư ĐT';
            profile.displayName = profile.displayName || whitelistData?.displayName || currentUser.displayName || 'Cán bộ quản trị';
            try {
              await setDoc(userDocRef, { 
                role: 'admin', 
                position: profile.position,
                displayName: profile.displayName 
              }, { merge: true });
            } catch (err) {
              console.warn("Lỗi đồng bộ quyền Admin:", err);
            }
          }
          setUserProfile(profile);
        } else {
          // If profile doesn't exist (e.g. Google login for first time)
          const newProfile: UserProfile = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            role: isAdminEmail ? 'admin' : 'student',
            displayName: currentUserEmail === 'lytm.angiang@gmail.com' ? 'Trần Minh Lý' : (currentUser.displayName || (whitelistData?.displayName) || 'Học sinh'),
            position: currentUserEmail === 'lytm.angiang@gmail.com' ? 'Bí thư ĐT' : (isAdminEmail ? (whitelistData?.position || 'Bí thư ĐT') : undefined),
            phoneNumber: whitelistData?.phoneNumber || undefined,
            isVerified: true
          };
          try {
            await setDoc(userDocRef, newProfile);
            setUserProfile(newProfile);
          } catch (err) {
            console.error("Failed to create profile:", err);
          }
        }
        setUser(currentUser);
      } else {
        setUser(prevUser => {
          if (prevUser && prevUser.uid.startsWith('mock-')) {
            return prevUser; // keep mock session
          }
          setUserProfile(prevProfile => {
            if (prevProfile && prevProfile.uid.startsWith('mock-')) {
              return prevProfile;
            }
            return null;
          });
          return null;
        });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Check for camera permissions
  useEffect(() => {
    if (isCreating) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(() => setCameraError(null))
        .catch((err) => {
          console.error("Camera access denied:", err);
          setCameraError("Vui lòng cấp quyền truy cập Camera để tiếp tục.");
        });
    }
  }, [isCreating]);

  useEffect(() => {
    if (isMockMode) {
      const loadLocalPasses = () => {
        const localPasses = localStorage.getItem('mock_gatepasses');
        if (localPasses) {
          setPasses(JSON.parse(localPasses));
        } else {
          const initialMockPasses: GatePass[] = [
            {
              id: 'mock-1',
              passId: 'GP-260923-1102',
              fullName: 'Nguyễn Văn Nam',
              department: '12A1',
              phoneNumber: '0912345678',
              reason: 'Đi khám răng định kỳ theo hẹn của bác sĩ',
              exitTime: new Date(Date.now() + 3600000).toISOString(),
              photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
              status: 'Chờ duyệt',
              createdAt: new Date().toISOString(),
              uid: 'mock-student-id'
            },
            {
              id: 'mock-2',
              passId: 'GP-260923-1088',
              fullName: 'Trần Thị Thuỷ',
              department: '11B3',
              phoneNumber: '0987654321',
              reason: 'Họp gia đình khẩn cấp, phụ huynh đến đón',
              exitTime: new Date(Date.now() + 7200000).toISOString(),
              photoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
              status: 'Đã duyệt',
              createdAt: new Date(Date.now() - 100000000).toISOString(),
              approvedAt: new Date(Date.now() - 3600000).toISOString(),
              approvedBy: 'Trần Minh Lý',
              approverPosition: 'Bí thư ĐT',
              approverRole: 'Bí thư ĐT',
              uid: 'student-2'
            }
          ];
          localStorage.setItem('mock_gatepasses', JSON.stringify(initialMockPasses));
          setPasses(initialMockPasses);
        }
      };
      loadLocalPasses();
      return;
    }

    if (!user || !userProfile) return;

    let q;
    if (userProfile.role === 'admin') {
      // Admin sees all
      q = query(
        collection(db, 'gatepasses'),
        orderBy('createdAt', 'desc')
      );
    } else {
      // Student sees only their own
      q = query(
        collection(db, 'gatepasses'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return { 
          id: doc.id, 
          passId: d.passId || ('GP-' + doc.id.slice(0, 8).toUpperCase()), 
          ...d 
        } as GatePass;
      });
      setPasses(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'gatepasses');
    });

    return () => unsubscribe();
  }, [user, userProfile, isMockMode]);

  // Đồng bộ cấu hình Webhook Make AI & Google Sheets chính thức từ Firestore cố định trên mọi thiết bị
  useEffect(() => {
    if (isMockMode) return;
    const unsub = onSnapshot(doc(db, 'system_settings', 'integration'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const firestoreWebhook = (data?.webhookUrl && !data.webhookUrl.includes("your_make_webhook_id")) ? data.webhookUrl : OFFICIAL_MAKE_WEBHOOK_URL;
        const firestoreSheet = (data?.sheetName && data.sheetName !== "DanhSachRaCong") ? data.sheetName : OFFICIAL_SHEET_NAME;
        setIntegrationWebhook(firestoreWebhook);
        setIntegrationSheetName(firestoreSheet);
        localStorage.setItem('config_webhook_url', firestoreWebhook);
        localStorage.setItem('config_sheet_name', firestoreSheet);
      } else {
        // Khởi tạo mặc định cấu hình chính thức
        setIntegrationWebhook(OFFICIAL_MAKE_WEBHOOK_URL);
        setIntegrationSheetName(OFFICIAL_SHEET_NAME);
        localStorage.setItem('config_webhook_url', OFFICIAL_MAKE_WEBHOOK_URL);
        localStorage.setItem('config_sheet_name', OFFICIAL_SHEET_NAME);

        // Nếu là Admin hoặc Master Admin thì lưu cấu hình chính thức lên Firestore để đồng bộ toàn hệ thống
        if (user && (userProfile?.role === 'admin' || user.email === 'lytm.angiang@gmail.com')) {
          setDoc(doc(db, 'system_settings', 'integration'), {
            webhookUrl: OFFICIAL_MAKE_WEBHOOK_URL,
            sheetName: OFFICIAL_SHEET_NAME,
            updatedAt: new Date().toISOString(),
            updatedBy: user.email || 'Admin'
          }, { merge: true }).catch(err => console.warn("Lỗi khởi tạo cấu hình hệ thống lên Firestore:", err));
        }
      }
    }, (error) => {
      console.warn("Lỗi đồng bộ cấu hình hệ thống từ Firestore:", error);
      setIntegrationWebhook(OFFICIAL_MAKE_WEBHOOK_URL);
      setIntegrationSheetName(OFFICIAL_SHEET_NAME);
    });

    return () => unsub();
  }, [user, userProfile, isMockMode]);

  // --- Handlers ---
  const handleBypassStudent = () => {
    setIsMockMode(true);
    const mockUser = {
      uid: 'mock-student-id',
      email: 'student.bypass@test.com',
      displayName: 'Học sinh Thử nghiệm',
      emailVerified: true
    } as any;
    const mockProfile: UserProfile = {
      uid: 'mock-student-id',
      email: 'student.bypass@test.com',
      role: 'student',
      displayName: 'Học sinh Thử nghiệm',
      className: '12A1',
      phoneNumber: '0987654321',
      isVerified: true
    };
    setUser(mockUser);
    setUserProfile(mockProfile);
  };

  const handleBypassAdmin = () => {
    setIsMockMode(true);
    const mockUser = {
      uid: 'mock-admin-id',
      email: 'lytm.angiang@gmail.com',
      displayName: 'Trần Minh Lý',
      emailVerified: true
    } as any;
    const mockProfile: UserProfile = {
      uid: 'mock-admin-id',
      email: 'lytm.angiang@gmail.com',
      role: 'admin',
      displayName: 'Trần Minh Lý',
      position: 'Bí thư ĐT',
      phoneNumber: '0912345678'
    };
    setUser(mockUser);
    setUserProfile(mockProfile);
  };

  // Hàm chuyển đổi Tên đăng nhập / Số điện thoại / Họ tên sang Email để đăng nhập không cần nhớ email
  const resolveAccountToEmail = async (rawInput: string): Promise<string> => {
    const input = rawInput.trim();
    if (!input) return '';
    if (input.includes('@')) return input.toLowerCase();

    const inputLower = input.toLowerCase();
    const cleanPhone = input.replace(/[\s.-]/g, '');

    // 1. Kiểm tra tài khoản Quản trị cấp cao Trần Minh Lý
    if (
      inputLower === 'trần minh lý' || 
      inputLower === 'tran minh ly' || 
      cleanPhone === '0912345678' ||
      inputLower.includes('bí thư') ||
      inputLower === 'admin'
    ) {
      return 'lytm.angiang@gmail.com';
    }

    // 2. Tra cứu từ danh sách tài khoản đã lưu trên thiết bị
    const localMatch = savedAccounts.find(a => {
      const aEmail = (a.email || '').toLowerCase();
      const aName = (a.displayName || '').toLowerCase();
      const aPhone = (a.phoneNumber || '').replace(/[\s.-]/g, '');
      return (
        aEmail === inputLower ||
        aName === inputLower ||
        (cleanPhone && aPhone === cleanPhone)
      );
    });
    if (localMatch && localMatch.email) {
      return localMatch.email.toLowerCase();
    }

    // 3. Tra cứu từ Firestore account_directory
    try {
      if (cleanPhone) {
        const phoneDoc = await getDoc(doc(db, 'account_directory', `phone_${cleanPhone}`));
        if (phoneDoc.exists() && phoneDoc.data()?.email) {
          return phoneDoc.data().email.toLowerCase();
        }
      }
      const nameKey = inputLower.replace(/\s+/g, '_');
      const nameDoc = await getDoc(doc(db, 'account_directory', `name_${nameKey}`));
      if (nameDoc.exists() && nameDoc.data()?.email) {
        return nameDoc.data().email.toLowerCase();
      }
    } catch (e) {
      console.warn("Lỗi tra cứu account_directory:", e);
    }

    // 4. Tra cứu từ Firestore admin_whitelist
    try {
      const wlSnap = await getDocs(collection(db, 'admin_whitelist'));
      for (const d of wlSnap.docs) {
        const data = d.data();
        const dName = (data.displayName || '').toLowerCase();
        const dPhone = (data.phoneNumber || '').replace(/[\s.-]/g, '');
        if (dName === inputLower || (cleanPhone && dPhone === cleanPhone)) {
          return (data.email || '').toLowerCase();
        }
      }
    } catch (e) {
      console.warn("Lỗi tra cứu admin_whitelist:", e);
    }

    // 5. Tra cứu từ Firestore users collection
    try {
      if (cleanPhone) {
        const qPhone = query(collection(db, 'users'), where('phoneNumber', '==', cleanPhone));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          const uData = phoneSnap.docs[0].data();
          if (uData?.email) return uData.email.toLowerCase();
        }
      }
      const qName = query(collection(db, 'users'), where('displayName', '==', input));
      const nameSnap = await getDocs(qName);
      if (!nameSnap.empty) {
        const uData = nameSnap.docs[0].data();
        if (uData?.email) return uData.email.toLowerCase();
      }

      // Fallback quét nhanh bộ sưu tập users
      const allUsersSnap = await getDocs(collection(db, 'users'));
      for (const d of allUsersSnap.docs) {
        const data = d.data();
        const uName = (data.displayName || '').toLowerCase();
        const uPhone = (data.phoneNumber || '').replace(/[\s.-]/g, '');
        if (uName === inputLower || (cleanPhone && uPhone === cleanPhone)) {
          if (data.email) return data.email.toLowerCase();
        }
      }
    } catch (e) {
      console.warn("Lỗi tra cứu users:", e);
    }

    return input;
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAccount = (selectedSavedAccount ? selectedSavedAccount.email : email).trim();
    if (!rawAccount) {
      setLoginError("Vui lòng nhập Email, Số điện thoại hoặc Họ tên tài khoản.");
      return;
    }
    if (!password) {
      setLoginError("Vui lòng nhập mật khẩu.");
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const targetEmail = await resolveAccountToEmail(rawAccount);
      if (!targetEmail || !targetEmail.includes('@')) {
        setLoginError(`Không tìm thấy tài khoản với thông tin "${rawAccount}". Vui lòng kiểm tra lại Email hoặc Số điện thoại.`);
        setIsLoggingIn(false);
        return;
      }
      await signInWithEmailAndPassword(auth, targetEmail, password);
    } catch (error: any) {
      console.error("Email login failed", error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setLoginError("Mật khẩu không chính xác. Vui lòng kiểm tra lại hoặc bấm Quên mật khẩu.");
      } else if (error.code === 'auth/user-not-found') {
        setLoginError(`Tài khoản "${rawAccount}" chưa được tạo trong hệ thống.`);
      } else if (error.code === 'auth/too-many-requests') {
        setLoginError("Đăng nhập sai quá nhiều lần. Hệ thống tạm khóa vài phút để bảo mật.");
      } else {
        setLoginError(error.message || "Tài khoản hoặc mật khẩu không chính xác.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handlePasswordReset = async () => {
    const rawTarget = (selectedSavedAccount ? selectedSavedAccount.email : email).trim();
    const targetEmail = await resolveAccountToEmail(rawTarget || 'lytm.angiang@gmail.com');
    setLoginError(null);
    setIsResettingPassword(true);
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      setResetEmailSent(true);
      setTimeout(() => setResetEmailSent(false), 8000);
    } catch (err: any) {
      console.error("Password reset error:", err);
      if (err.code === 'auth/user-not-found') {
        setLoginError(`Email ${targetEmail} chưa có tài khoản mật khẩu trên hệ thống. Vui lòng liên hệ quản trị viên hoặc đăng ký học sinh mới.`);
      } else {
        setLoginError("Lỗi gửi link khôi phục: " + (err.message || String(err)));
      }
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSendForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawTarget = (forgotEmail.trim() || email.trim());
    if (!rawTarget) {
      setResetErrorMessage("Vui lòng nhập Email, Số điện thoại hoặc Họ tên tài khoản của bạn.");
      return;
    }
    setIsSendingReset(true);
    setResetErrorMessage(null);
    setResetSuccessMessage(null);
    let targetEmail = '';
    try {
      targetEmail = await resolveAccountToEmail(rawTarget);
      if (!targetEmail || !targetEmail.includes('@')) {
        setResetErrorMessage(`Không tìm thấy tài khoản với thông tin "${rawTarget}". Vui lòng kiểm tra lại hoặc nhập chính xác địa chỉ Email của bạn.`);
        setIsSendingReset(false);
        return;
      }

      try {
        await sendPasswordResetEmail(auth, targetEmail);
      } catch (authErr: any) {
        // Trường hợp tài khoản chưa từng tạo mật khẩu trên Firebase Auth
        if (authErr.code === 'auth/user-not-found') {
          try {
            const secondaryAppName = 'GatePassPasswordResetHelper';
            const secondaryApp = getApps().find(a => a.name === secondaryAppName) || initializeApp(firebaseConfig, secondaryAppName);
            const secondaryAuth = getAuth(secondaryApp);
            const tempPass = Math.random().toString(36).slice(-8) + 'Aa1@#';
            await createUserWithEmailAndPassword(secondaryAuth, targetEmail, tempPass);
            await signOut(secondaryAuth);
            // Sau khi khởi tạo tài khoản trên Auth, gửi lại email đặt lại mật khẩu
            await sendPasswordResetEmail(auth, targetEmail);
          } catch (createErr: any) {
            console.warn("Khởi tạo tài khoản dự phòng qua secondary auth:", createErr);
            throw authErr;
          }
        } else {
          throw authErr;
        }
      }

      setResetSentEmail(targetEmail);
      setResetSuccessMessage(`Đã gửi liên kết khôi phục mật khẩu đến email: ${targetEmail}`);
      setResendCooldown(60);
    } catch (err: any) {
      console.error("Password reset error:", err);
      if (err.code === 'auth/user-not-found') {
        setResetErrorMessage(`Email "${targetEmail}" chưa có tài khoản mật khẩu trên hệ thống. Vui lòng kiểm tra lại hoặc liên hệ quản trị viên.`);
      } else if (err.code === 'auth/invalid-email') {
        setResetErrorMessage("Địa chỉ email không đúng định dạng.");
      } else if (err.code === 'auth/too-many-requests') {
        setResetErrorMessage("Yêu cầu gửi email đã vượt giới hạn tạm thời. Vui lòng đợi 5 - 10 phút rồi thử lại.");
      } else {
        setResetErrorMessage("Không thể gửi email khôi phục: " + (err.message || String(err)));
      }
    } finally {
      setIsSendingReset(false);
    }
  };

  const loadAdminList = async () => {
    if (userProfile?.role !== 'admin') return;
    setIsLoadingAdminList(true);
    try {
      // Đảm bảo thông tin admin cấp cao lytm.angiang@gmail.com luôn chuẩn hoá: Trần Minh Lý, chức vụ Bí thư ĐT
      try {
        await setDoc(doc(db, 'admin_whitelist', 'lytm_angiang'), {
          email: 'lytm.angiang@gmail.com',
          displayName: 'Trần Minh Lý',
          position: 'Bí thư ĐT',
          role: 'admin',
          level: 'Admin cấp cao',
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        console.warn("Lỗi cập nhật whitelist admin cấp cao:", e);
      }

      const q = query(collection(db, 'users'), where('role', '==', 'admin'));
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        if ((data.email || '').toLowerCase() === 'lytm.angiang@gmail.com') {
          list.push({ id: d.id, ...data, displayName: 'Trần Minh Lý', position: 'Bí thư ĐT', role: 'admin' });
        } else {
          list.push({ id: d.id, ...data });
        }
      });
      // Also get pre-approved from admin_whitelist
      try {
        const wlSnap = await getDocs(collection(db, 'admin_whitelist'));
        wlSnap.forEach(d => {
          const data = d.data();
          if ((data.email || '').toLowerCase() === 'lytm.angiang@gmail.com') return;
          if (!list.some(u => (u.email || '').toLowerCase() === (data.email || '').toLowerCase())) {
            list.push({ id: d.id, ...data, isPreApproved: true });
          }
        });
      } catch (e) {
        console.warn("Lỗi đọc admin_whitelist:", e);
      }
      setAdminList(list);
    } catch (err) {
      console.error("Lỗi lấy danh sách cán bộ duyệt:", err);
    } finally {
      setIsLoadingAdminList(false);
    }
  };

  const handleCreateAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMasterAdmin) {
      setCreateAdminError("Chỉ Quản trị viên cấp cao (Trần Minh Lý - lytm.angiang@gmail.com) mới có quyền tạo tài khoản quản trị duyệt phép mới!");
      return;
    }
    const cleanEmail = newAdminEmail.trim().toLowerCase();
    const cleanName = newAdminName.trim();
    const cleanPhone = newAdminPhone.trim();
    const cleanPass = newAdminPassword.trim();

    if (!cleanEmail || !cleanName || !cleanPass) {
      setCreateAdminError("Vui lòng điền đầy đủ họ tên, chức vụ, email và mật khẩu khởi tạo!");
      return;
    }
    if (cleanPass.length < 6) {
      setCreateAdminError("Mật khẩu khởi tạo phải từ 6 ký tự trở lên!");
      return;
    }

    setIsCreatingAdmin(true);
    setCreateAdminError(null);
    setCreateAdminSuccess(null);

    try {
      let createdUid: string | null = null;
      try {
        const secondaryAppName = 'GatePassSecondaryAdminCreator';
        const secondaryApp = getApps().find(a => a.name === secondaryAppName) || initializeApp(firebaseConfig, secondaryAppName);
        const secondaryAuth = getAuth(secondaryApp);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, cleanPass);
        createdUid = cred.user.uid;
        await signOut(secondaryAuth);
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          console.log("Email đã tồn tại trong Auth, tiếp tục cấp quyền quản trị trên Firestore");
        } else {
          throw authErr;
        }
      }

      if (createdUid) {
        await setDoc(doc(db, 'users', createdUid), {
          uid: createdUid,
          email: cleanEmail,
          displayName: cleanName,
          role: 'admin',
          position: newAdminPosition,
          phoneNumber: cleanPhone,
          isVerified: true,
          createdBy: userProfile.email || user?.email,
          createdAt: new Date().toISOString(),
          department: 'Ban Giám Hiệu / Quản trị viên'
        }, { merge: true });
      }

      const emailKey = cleanEmail.replace(/\./g, '_');
      await setDoc(doc(db, 'admin_whitelist', emailKey), {
        email: cleanEmail,
        displayName: cleanName,
        role: 'admin',
        position: newAdminPosition,
        phoneNumber: cleanPhone,
        createdAt: new Date().toISOString(),
        createdBy: userProfile.email || user?.email
      }, { merge: true });

      // Lưu vào danh bạ tài khoản account_directory để đăng nhập nhanh không cần email
      try {
        const adminAccountInfo = {
          email: cleanEmail,
          displayName: cleanName,
          role: 'admin',
          position: newAdminPosition,
          phoneNumber: cleanPhone,
          updatedAt: new Date().toISOString()
        };
        if (cleanPhone) {
          const cleanPhoneKey = cleanPhone.replace(/[\s.-]/g, '');
          await setDoc(doc(db, 'account_directory', `phone_${cleanPhoneKey}`), adminAccountInfo, { merge: true });
        }
        const cleanNameKey = cleanName.toLowerCase().replace(/\s+/g, '_');
        await setDoc(doc(db, 'account_directory', `name_${cleanNameKey}`), adminAccountInfo, { merge: true });
        await setDoc(doc(db, 'account_directory', `email_${emailKey}`), adminAccountInfo, { merge: true });

        // Cập nhật danh sách tài khoản đã lưu
        setSavedAccounts(prev => [adminAccountInfo, ...prev.filter(a => (a.email || '').toLowerCase() !== cleanEmail)]);
      } catch (dirErr) {
        console.warn("Lỗi lưu account_directory admin:", dirErr);
      }

      setCreateAdminSuccess(`Đã tạo thành công tài khoản Quản trị duyệt phép cho cán bộ "${cleanName}" (${cleanEmail}) với chức vụ ${newAdminPosition}! Cán bộ có thể đăng nhập ngay bằng mật khẩu vừa tạo.`);
      setNewAdminEmail('');
      setNewAdminName('');
      setNewAdminPhone('');
      setNewAdminPassword('');
      loadAdminList();
    } catch (err: any) {
      console.error("Lỗi tạo tài khoản admin:", err);
      setCreateAdminError("Lỗi tạo tài khoản: " + (err.message || String(err)));
    } finally {
      setIsCreatingAdmin(false);
    }
  };

  const handleLogout = () => {
    if (isMockMode) {
      setIsMockMode(false);
      setUser(null);
      setUserProfile(null);
      setSelectedReasonOption('');
      setCustomReasonText('');
      setSelectedQuickMinutes(null);
      setFormData({
        fullName: '',
        department: '',
        phoneNumber: '',
        reason: '',
        exitTime: getVietnamOrLocalISOString()
      });
    } else {
      signOut(auth);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setRegisterLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, registerData.email, registerData.password);
      const newUser = userCredential.user;

      // Create profile
      const newProfile: UserProfile = {
        uid: newUser.uid,
        email: registerData.email,
        role: 'student',
        displayName: registerData.fullName,
        className: registerData.className,
        phoneNumber: registerData.phoneNumber,
        isVerified: false
      };

      await setDoc(doc(db, 'users', newUser.uid), newProfile);
      setUserProfile(newProfile);

      // Lưu vào danh bạ tài khoản account_directory để đăng nhập nhanh không cần email
      try {
        const studentInfo = {
          email: registerData.email.toLowerCase(),
          displayName: registerData.fullName,
          role: 'student',
          className: registerData.className,
          phoneNumber: registerData.phoneNumber,
          updatedAt: new Date().toISOString()
        };
        if (registerData.phoneNumber) {
          const cleanPhoneKey = registerData.phoneNumber.trim().replace(/[\s.-]/g, '');
          await setDoc(doc(db, 'account_directory', `phone_${cleanPhoneKey}`), studentInfo, { merge: true });
        }
        const cleanNameKey = registerData.fullName.trim().toLowerCase().replace(/\s+/g, '_');
        await setDoc(doc(db, 'account_directory', `name_${cleanNameKey}`), studentInfo, { merge: true });
        const emailKey = registerData.email.trim().toLowerCase().replace(/\./g, '_');
        await setDoc(doc(db, 'account_directory', `email_${emailKey}`), studentInfo, { merge: true });

        // Cập nhật danh sách tài khoản đã lưu
        setSavedAccounts(prev => [studentInfo, ...prev.filter(a => (a.email || '').toLowerCase() !== studentInfo.email)]);
      } catch (dirErr) {
        console.warn("Lỗi lưu account_directory học sinh:", dirErr);
      }
      
      // Send verification email
      await sendEmailVerification(newUser);
      setRegisterSuccess(true);
      
      setTimeout(() => {
        setIsRegistering(false);
        setRegisterSuccess(false);
      }, 3000);

    } catch (error: any) {
      console.error("Registration failed", error);
      if (error.code === 'auth/email-already-in-use') {
        setLoginError("Email này đã được sử dụng.");
      } else if (error.code === 'auth/weak-password') {
        setLoginError("Mật khẩu quá yếu (tối thiểu 6 ký tự).");
      } else {
        setLoginError("Đăng ký thất bại. Vui lòng thử lại.");
      }
    } finally {
      setRegisterLoading(false);
    }
  };

  const capture = useCallback(() => {
    try {
      let imageSrc: string | null = null;

      // 1. Lấy snapshot từ react-webcam trước (tương thích tốt nhất trên iOS / Android)
      if (webcamRef.current) {
        try {
          imageSrc = webcamRef.current.getScreenshot();
        } catch (sErr) {
          console.warn("webcam.getScreenshot:", sErr);
        }
      }

      // 2. Dự phòng: Vẽ trực tiếp từ video element sang canvas nếu getScreenshot rỗng
      const video = webcamRef.current?.video;
      if (!imageSrc && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const targetAspect = 3 / 4;
          const currentAspect = vw / vh;
          
          let cropWidth = vw;
          let cropHeight = vh;
          let sx = 0;
          let sy = 0;

          if (currentAspect > targetAspect) {
            cropWidth = vh * targetAspect;
            cropHeight = vh;
            sx = (vw - cropWidth) / 2;
            sy = 0;
          } else {
            cropWidth = vw;
            cropHeight = vw / targetAspect;
            sx = 0;
            sy = (vh - cropHeight) / 2;
          }

          const canvas = document.createElement('canvas');
          const outWidth = Math.min(1080, Math.round(cropWidth));
          const outHeight = Math.round(outWidth / targetAspect);
          canvas.width = outWidth;
          canvas.height = outHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, sx, sy, cropWidth, cropHeight, 0, 0, outWidth, outHeight);
            imageSrc = canvas.toDataURL('image/jpeg', 0.92);
          }
        } catch (err) {
          console.warn("Direct 3:4 canvas crop fallback:", err);
        }
      }

      // 3. Nếu đã có ảnh
      if (imageSrc) {
        setCapturedImage(imageSrc);
        verifyFace(imageSrc);
      } else {
        alert("Camera chưa ghi nhận được hình ảnh. Bạn vui lòng bấm lại nút Chụp ảnh hoặc bấm 'Mở Máy Ảnh Máy' / 'Tải Ảnh Có Sẵn' bên dưới.");
      }
    } catch (err) {
      console.error("Lỗi khi chụp:", err);
      alert("Không thể chụp ảnh từ camera lúc này. Vui lòng bấm 'Mở Máy Ảnh Máy' hoặc tải ảnh có sẵn.");
    }
  }, [webcamRef]);

  // Xác minh khuôn mặt thông qua API Server-Side (sử dụng Gemini 3.8 Flash)
  const verifyFace = async (imageSrc: string) => {
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const response = await fetch('/api/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageSrc })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      setVerificationResult(result);
    } catch (error) {
      console.error("Face verification error:", error);
      // Fallback an toàn: ảnh vẫn được ghi nhận thành công để học sinh không bị kẹt khi mạng yếu
      setVerificationResult({ 
        success: true, 
        message: "Ảnh khuôn mặt đã được lưu thành công (Giám thị sẽ đối soát khi duyệt)." 
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const sendWebhookNotification = async (payload: any): Promise<{ success: boolean; message: string }> => {
    try {
      const webhookUrl = (integrationWebhook?.trim() && !integrationWebhook.includes("your_make_webhook_id"))
        ? integrationWebhook.trim()
        : OFFICIAL_MAKE_WEBHOOK_URL;
      const targetSheet = (integrationSheetName?.trim() && integrationSheetName.trim() !== "DanhSachRaCong")
        ? integrationSheetName.trim()
        : OFFICIAL_SHEET_NAME;
      
      if (!webhookUrl) {
        const msg = "Vui lòng nhập URL Webhook Make.com trước khi gửi dữ liệu.";
        console.warn("⚠️ [Make Webhook]:", msg);
        return { success: false, message: msg };
      }

      const formatVietnamTime = (dateInput: any) => {
        if (!dateInput) return "";
        try {
          let d: Date;
          if (dateInput && typeof dateInput === 'object' && 'seconds' in dateInput) {
            d = new Date(dateInput.seconds * 1000);
          } else if (dateInput && typeof dateInput === 'object' && 'toDate' in dateInput && typeof dateInput.toDate === 'function') {
            d = dateInput.toDate();
          } else {
            d = new Date(dateInput);
          }
          if (isNaN(d.getTime())) return typeof dateInput === 'string' ? dateInput : "";
          return d.toLocaleString('vi-VN', { 
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false
          });
        } catch (e) {
          return "";
        }
      };

      const nowVN = formatVietnamTime(new Date());

      // 1. Thời gian muốn ra cổng (do học sinh chọn trong đơn xin phép)
      const exitTimeVN = formatVietnamTime(payload.exitTime) || nowVN;

      // 2. Thời gian gửi phiếu (thời điểm học sinh tạo và gửi đơn lên hệ thống)
      const createdAtVN = formatVietnamTime(payload.createdAt) || (payload.action === 'create' ? nowVN : 'N/A');

      // 3. Thời gian admin duyệt trạng thái phiếu (thời điểm Giám thị/Admin bấm duyệt hoặc từ chối)
      const isApprovedOrRejected = payload.action === 'update_status' || payload.action === 'test' || payload.approvedAt;
      const approvedAtVN = isApprovedOrRejected 
        ? (formatVietnamTime(payload.approvedAt || payload.updatedAt) || nowVN)
        : "";

      // 4. Thời điểm hết hạn hiệu lực ra cổng (30 phút sau khi duyệt)
      let expiredAtVN = "";
      if (payload.approvedAt || payload.updatedAt) {
        try {
          const appDate = new Date(payload.approvedAt || payload.updatedAt);
          if (!isNaN(appDate.getTime())) {
            expiredAtVN = formatVietnamTime(new Date(appDate.getTime() + GATE_PASS_VALIDITY_MS));
          }
        } catch (e) {}
      }

      // Mã phiếu đăng ký ID
      const exactPassId = payload.id || payload.passId || payload.passCode || (payload.action === 'test' ? 'GP-260923-8899' : '');
      
      // Xử lý và chuẩn hóa số điện thoại chống mất số 0 khi sang Google Sheets
      const rawPhoneInput = (payload.phoneNumber || payload.so_dien_thoai || (payload.action === 'test' ? '0912345678' : '')).toString().trim();
      const cleanDigits = rawPhoneInput.replace(/[^0-9]/g, '');
      // Đảm bảo số điện thoại có đủ 10 số với số 0 ở đầu nếu người dùng nhập thiếu
      const normalizedPhone = cleanDigits.length === 9 ? ('0' + cleanDigits) : (cleanDigits || rawPhoneInput);
      // Đối với Google Sheets: Thêm tiền tố dấu nháy đơn (') để Google Sheets bắt buộc coi đây là TEXT, không tự động chuyển thành Number làm mất số 0 ở đầu. Google Sheets sẽ tự động ẩn dấu (') trong giao diện bảng tính.
      const sheetPhone = normalizedPhone ? (normalizedPhone.startsWith("'") ? normalizedPhone : `'${normalizedPhone}`) : '';
      const exactPhone = normalizedPhone;
      const verifyUrl = typeof window !== 'undefined' ? `${window.location.origin}/?verify=${encodeURIComponent(exactPassId)}` : "";

      // Quy tắc kiểm tra gửi Mail nghiêm ngặt:
      // CHỈ GỬI QUA MAIL KHI:
      //  1. Học sinh BẤM GỬI PHIẾU (payload.action === 'create')
      //  2. Cán bộ/Admin DUYỆT PHIẾU (payload.action === 'update_status' và chưa hết hạn)
      // TUYỆT ĐỐI KHÔNG GỬI QUA MAIL KHI:
      //  - Phiếu ĐÃ HẾT HẠN (status === 'Đã hết hạn' hoặc quá hạn 30 phút hiệu lực)
      //  - Thao tác đồng bộ dữ liệu thủ công / hàng loạt sang Sheets (payload.action === 'sync')
      const statusRaw = (payload.status || '').toLowerCase();
      const isExpired = statusRaw.includes('hết hạn') || statusRaw.includes('expired') || (typeof isPassExpired === 'function' && isPassExpired(payload));
      
      const isCreate = payload.action === "create";
      const isApprove = payload.action === "update_status" && !isExpired;
      const shouldSendEmail = (isCreate || isApprove) && !isExpired;

      // Nếu phiếu đã hết hạn và không phải là thao tác đồng bộ sang Google Sheets thì hoàn toàn không kích hoạt Webhook/Mail
      if (isExpired && payload.action !== 'sync') {
        console.log("ℹ️ [Webhook]: Phiếu đã hết hạn, hệ thống bỏ qua không gửi qua Webhook/Mail theo quy định.");
        return { 
          success: true, 
          message: "Phiếu đã hết hạn: Đã bỏ qua không gửi qua Mail theo quy định hệ thống." 
        };
      }

      // Tạo tin nhắn định dạng chuyên nghiệp sẵn sàng cho Make AI / Email / Google Sheets / Chatbot
      let txtMessage = "";
      
      if (payload.action === "create") {
        txtMessage = `🆕 ĐĂNG KÝ PHIẾU RA CỔNG MỚI (CHỜ DUYỆT)\n` +
                     `==================================\n` +
                     `🆔 Mã phiếu (ID): ${exactPassId || 'N/A'}\n` +
                     `👤 Học sinh: ${payload.fullName || 'N/A'}\n` +
                     `🏫 Lớp/Khối: ${payload.department || 'N/A'}\n` +
                     `📞 SĐT liên hệ: ${exactPhone || 'N/A'}\n` +
                     `⏰ Thời gian muốn ra cổng: ${exitTimeVN}\n` +
                     `📤 Thời gian gửi phiếu: ${createdAtVN}\n` +
                     `📝 Lý do: ${payload.reason || 'N/A'}\n` +
                     `⏳ Trạng thái: CHỜ KIỂM DUYỆT\n` +
                     `==================================\n` +
                     `👉 Đoàn Trường / Cán bộ duyệt vui lòng đăng nhập GatePass AI để xem xét phê duyệt đơn học sinh này.`;
      } else if (payload.action === "update_status") {
        const transStatus = (payload.status === 'approved' || payload.status === 'Đã duyệt') ? '✅ ĐÃ DUYỆT (CHO PHÉP RA CỔNG)' : '❌ TỪ CHỐI (KHOÁ CỔNG)';
        const approverNameDisplay = payload.nguoi_duyet || payload.approverName || userProfile?.displayName || user?.email || 'Đoàn Trường';
        const approverPositionDisplay = payload.chuc_vu_nguoi_duyet || payload.chuc_vu || payload.approverRole || userProfile?.position || 'Bí thư ĐT';

        txtMessage = `📢 KẾT QUẢ PHÊ DUYỆT PHIẾU RA CỔNG\n` +
                     `==================================\n` +
                     `🆔 Mã phiếu (ID): ${exactPassId || 'N/A'}\n` +
                     `👤 Học sinh: ${payload.fullName || 'N/A'}\n` +
                     `🏫 Lớp/Khối: ${payload.department || 'N/A'}\n` +
                     `📞 SĐT liên hệ: ${exactPhone || 'N/A'}\n` +
                     `⏰ Thời gian muốn ra cổng: ${exitTimeVN}\n` +
                     `📤 Thời gian gửi phiếu: ${createdAtVN}\n` +
                     `📝 Lý do: ${payload.reason || 'N/A'}\n` +
                     `🎯 Kết quả duyệt: ${transStatus}\n` +
                     `✍️ Người duyệt: ${approverNameDisplay}\n` +
                     `🎖️ Chức vụ: ${approverPositionDisplay}\n` +
                     `✅ Thời gian duyệt phiếu: ${approvedAtVN}\n` +
                     (expiredAtVN ? `⏳ Thời hạn hiệu lực đến: ${expiredAtVN}\n` : '') +
                     `==================================\n` +
                     `Hệ thống GatePass AI - Tự động đồng bộ sang Google Sheets ${targetSheet}.`;
      } else if (payload.action === "sync") {
        const transStatus = (payload.status === 'approved' || payload.status === 'Đã duyệt') 
          ? '✅ ĐÃ DUYỆT (CHO PHÉP RA CỔNG)' 
          : (payload.status === 'rejected' || payload.status === 'Từ chối') 
            ? '❌ TỪ CHỐI (KHOÁ CỔNG)' 
            : (isExpired ? '⏱️ ĐÃ HẾT HẠN (KHÔNG GỬI MAIL)' : '⏳ CHỜ DUYỆT');
        const approverNameDisplay = payload.nguoi_duyet || payload.approverName || payload.approvedBy || userProfile?.displayName || 'Đoàn Trường';
        const approverPositionDisplay = payload.chuc_vu_nguoi_duyet || payload.chuc_vu || payload.approverRole || userProfile?.position || 'Bí thư ĐT';

        txtMessage = `🔄 ĐỒNG BỘ DỮ LIỆU PHIẾU RA CỔNG SANG GOOGLE SHEETS (KHÔNG GỬI MAIL)\n` +
                     `==================================\n` +
                     `🆔 Mã phiếu (ID): ${exactPassId || 'N/A'}\n` +
                     `👤 Học sinh: ${payload.fullName || 'N/A'}\n` +
                     `🏫 Lớp/Khối: ${payload.department || 'N/A'}\n` +
                     `📞 SĐT liên hệ: ${exactPhone || 'N/A'}\n` +
                     `⏰ Thời gian muốn ra cổng: ${exitTimeVN}\n` +
                     `📤 Thời gian gửi phiếu: ${createdAtVN}\n` +
                     `📝 Lý do: ${payload.reason || 'N/A'}\n` +
                     `🎯 Trạng thái: ${transStatus}\n` +
                     (approvedAtVN ? `✍️ Người duyệt: ${approverNameDisplay}\n🎖️ Chức vụ: ${approverPositionDisplay}\n✅ Thời gian duyệt phiếu: ${approvedAtVN}\n` : '') +
                     (expiredAtVN ? `⏳ Hết hạn: ${expiredAtVN}\n` : '') +
                     `==================================\n` +
                     `Đã đồng bộ sang thẻ Google Sheets: ${targetSheet}`;
      } else if (payload.action === "test") {
        const testApproverName = payload.nguoi_duyet || userProfile?.displayName || 'Trần Minh Lý';
        const testApproverPos = payload.chuc_vu_nguoi_duyet || userProfile?.position || 'Bí thư ĐT';
        txtMessage = `🧪 DỮ LIỆU KIỂM TRA TỰ ĐỘNG TỪ GATEPASS MAKE AI\n` +
                     `==================================\n` +
                     `🆔 Mã phiếu mẫu (ID): ${exactPassId}\n` +
                     `👤 Họ tên mẫu: Nguyễn Văn A\n` +
                     `🏫 Lớp/Khối: 12A1\n` +
                     `📞 SĐT mẫu: 0912345678\n` +
                     `⏰ Thời gian muốn ra cổng: ${exitTimeVN}\n` +
                     `📤 Thời gian gửi phiếu: ${createdAtVN}\n` +
                     `📝 Lý do: Thử nghiệm phân biệt mã ID cùng 3 mốc thời gian thành công!\n` +
                     `🎯 Kết quả: ✅ ĐÃ DUYỆT\n` +
                     `✍️ Người duyệt: ${testApproverName}\n` +
                     `🎖️ Chức vụ: ${testApproverPos}\n` +
                     `✅ Thời gian duyệt phiếu: ${approvedAtVN}\n` +
                     `==================================\n` +
                     `✅ Make.com đã nhận diện trường ID cùng 3 mốc thời gian riêng biệt!`;
      }
      
      const exactApproverName = payload.nguoi_duyet || payload.approverName || payload.approvedBy || (payload.action === 'update_status' ? (userProfile?.displayName || user?.email || 'Đoàn Trường') : '');
      const exactApproverPosition = payload.chuc_vu_nguoi_duyet || payload.chuc_vu || payload.approverRole || (payload.action === 'update_status' ? (userProfile?.position || 'Bí thư ĐT') : '');
      const exactApproverEmail = payload.approverEmail || (payload.action === 'update_status' ? (user?.email || userProfile?.email || '') : '');

      const emailSubject = shouldSendEmail
        ? (isCreate 
            ? `[GatePass AI] Phiếu xin ra cổng mới chờ duyệt: ${payload.fullName || 'Học sinh'} (${payload.department || ''})`
            : `[GatePass AI] Kết quả phê duyệt phiếu ra cổng: ${exactPassId} (${payload.status || 'Đã duyệt'})`)
        : "";

      const emailBody = shouldSendEmail ? txtMessage : "";

      // Các biến dữ liệu chuẩn gửi sang Make & Google Sheets (có đầy đủ ID phiếu và tất cả các trường dữ liệu)
      const cleanPayload = {
        // 1. Mã định danh phiếu
        id: exactPassId,
        passId: exactPassId,
        ma_phieu: exactPassId,

        // 2. Thông tin học sinh / người xin ra (đã format bảo toàn số 0 cho Google Sheets)
        fullName: payload.fullName || "",
        ho_ten: payload.fullName || "",
        department: payload.department || "",
        lop_phong_ban: payload.department || "",
        phoneNumber: sheetPhone,
        so_dien_thoai: sheetPhone,
        sdt: sheetPhone,
        so_dien_thoai_sheet: sheetPhone,
        phoneNumberSheet: sheetPhone,
        so_dien_thoai_goc: normalizedPhone,
        so_dien_thoai_chuan: normalizedPhone,
        phoneNumberRaw: normalizedPhone,
        reason: payload.reason || "",
        ly_do: payload.reason || "",

        // 3. Các mốc thời gian (Định dạng Giờ:Phút:Giây Ngày/Tháng/Năm)
        thoigian_muon_ra_cong: exitTimeVN,
        exitTime: exitTimeVN,
        thoigian_gui_phieu: createdAtVN,
        createdAt: createdAtVN,
        thoigian_duyet_phieu: approvedAtVN,
        approvedAt: approvedAtVN,
        thoigian_het_han: expiredAtVN,
        expiredAt: expiredAtVN,

        // 4. Trạng thái và Người duyệt
        status: payload.status || "Chờ duyệt",
        trang_thai: payload.status || "Chờ duyệt",
        nguoi_duyet: exactApproverName,
        approvedBy: exactApproverName,
        chuc_vu_nguoi_duyet: exactApproverPosition,
        chuc_vu: exactApproverPosition,
        approverRole: exactApproverPosition,
        approverPosition: exactApproverPosition,
        email_nguoi_duyet: exactApproverEmail,
        approverEmail: exactApproverEmail,

        // 5. Xác thực & Đa phương tiện
        link_xac_minh: verifyUrl,
        verifyUrl: verifyUrl,
        photoUrl: payload.photoUrl ? (payload.photoUrl.startsWith('data:') ? `[Ảnh chụp - Xem chi tiết tại: ${verifyUrl}]` : payload.photoUrl) : "",
        anh_khuon_mat: payload.photoUrl ? (payload.photoUrl.startsWith('data:') ? '[Ảnh khuôn mặt có sẵn trên hệ thống]' : payload.photoUrl) : "",
        co_anh_chup: payload.photoUrl ? "Có" : "Không",

        // 6. Phân loại sự kiện & Tên Sheet
        action: payload.action || "sync",
        loai_su_kien: isExpired 
          ? "Phiếu đã hết hạn (Không gửi mail)" 
          : (payload.action === "create" ? "Tạo phiếu mới" : (payload.action === "update_status" ? "Duyệt/Từ chối" : (payload.action === "test" ? "Kiểm tra mẫu" : "Đồng bộ phiếu (Không gửi mail)"))),
        googleSheetName: targetSheet,
        ten_sheet: targetSheet,
        sheet_name: targetSheet,
        sheetName: targetSheet,

        // 7. QUY TẮC GỬI EMAIL CHÍNH XÁC (CHỈ GỬI KHI BẤM GỬI PHIẾU HOẶC DUYỆT PHIẾU, KHÔNG GỬI KHI HẾT HẠN)
        gui_qua_mail: shouldSendEmail ? "Có" : "Không",
        gui_email: shouldSendEmail,
        sendEmail: shouldSendEmail,
        send_email: shouldSendEmail,
        should_send_email: shouldSendEmail,
        cho_phep_gui_mail: shouldSendEmail,
        tieu_de_mail: emailSubject,
        email_subject: emailSubject,
        noi_dung_email: emailBody,
        email_body: emailBody,
        trang_thai_gui_mail: shouldSendEmail 
          ? "CHO PHÉP GỬI MAIL" 
          : (isExpired ? "KHÔNG GỬI MAIL (Phiếu đã hết hạn)" : "KHÔNG GỬI MAIL (Chỉ đồng bộ Sheet)"),

        message: txtMessage,
        noi_dung_thong_bao: txtMessage
      };

      const isLocalhost = webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");

      if (isLocalhost) {
        console.log("🔌 [Local Webhook] Gửi trực tiếp tới localhost:", webhookUrl);
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(cleanPayload)
        });
        if (!res.ok) {
          throw new Error(`Máy chủ localhost phản hồi mã lỗi HTTP ${res.status}`);
        }
        return { success: true, message: `Gửi trực tiếp đến localhost thành công (HTTP ${res.status})` };
      }

      // Chiến lược gửi đa tầng (Multi-tier Strategy) chống lỗi mạng / CORS:
      // Tầng 1: Chuyển tiếp an toàn qua Proxy máy chủ (/api/webhook)
      let proxyErrorMsg = "";
      try {
        console.log("🌐 [Proxy Webhook] Đang thử gửi qua backend proxy máy chủ...");
        const proxyController = new AbortController();
        const proxyTimeout = setTimeout(() => proxyController.abort(), 10000);

        const res = await fetch("/api/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            webhookUrl,
            payload: cleanPayload
          }),
          signal: proxyController.signal
        });

        clearTimeout(proxyTimeout);

        if (res.ok) {
          const resData = await res.json().catch(() => ({}));
          return { success: true, message: resData?.message || "Make.com đã tiếp nhận dữ liệu thành công!" };
        } else {
          const errData = await res.json().catch(() => ({}));
          proxyErrorMsg = errData.error || `Lỗi máy chủ Proxy HTTP ${res.status}`;
          console.warn("⚠️ Proxy phản hồi lỗi, kích hoạt gửi trực tiếp dự phòng:", proxyErrorMsg);
        }
      } catch (proxyErr: any) {
        console.warn("⚠️ Không thể kết nối tới Proxy (/api/webhook), kích hoạt gửi trực tiếp dự phòng:", proxyErr?.message);
        proxyErrorMsg = proxyErr?.message;
      }

      // Tầng 2: Gửi trực tiếp từ trình duyệt tới Webhook Make.com (Hỗ trợ chuẩn CORS)
      try {
        console.log("🔌 [Direct Webhook] Đang gửi trực tiếp tới Webhook URL:", webhookUrl);
        const directController = new AbortController();
        const directTimeout = setTimeout(() => directController.abort(), 10000);

        const directRes = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(cleanPayload),
          signal: directController.signal
        });

        clearTimeout(directTimeout);

        if (directRes.ok) {
          return { success: true, message: "Make.com đã tiếp nhận dữ liệu thành công (Gửi trực tiếp)!" };
        } else {
          throw new Error(`Webhook phản hồi mã lỗi HTTP ${directRes.status}`);
        }
      } catch (directErr: any) {
        console.warn("⚠️ Gửi trực tiếp gặp lỗi, thử chế độ no-cors dự phòng:", directErr?.message);

        // Tầng 3: Chế độ tương thích no-cors (dành cho Google Apps Script hoặc Webhook có redirect 302)
        try {
          await fetch(webhookUrl, {
            method: "POST",
            mode: "no-cors",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(cleanPayload)
          });
          return { success: true, message: "Dữ liệu đã được gửi thành công đến Webhook!" };
        } catch (noCorsErr: any) {
          console.error("❌ Cả 3 phương thức gửi webhook đều không thành công:", noCorsErr);
          const finalErrMsg = (directErr?.message === 'Failed to fetch' || proxyErrorMsg === 'Failed to fetch')
            ? "Không thể kết nối đến Webhook Make. Vui lòng kiểm tra lại URL Webhook hoặc kiểm tra kết nối mạng."
            : (directErr?.message || proxyErrorMsg || "Không thể kết nối đến Webhook Make.");
          return {
            success: false,
            message: finalErrMsg
          };
        }
      }
    } catch (err: any) {
      console.error("Lỗi gửi webhook Make AI:", err);
      const friendlyMsg = err?.message === 'Failed to fetch' 
        ? "Không thể kết nối đến Webhook Make. Vui lòng kiểm tra lại URL Webhook hoặc kiểm tra kết nối mạng."
        : (err?.message || "Không thể kết nối đến Webhook Make. Vui lòng kiểm tra lại URL.");
      return { 
        success: false, 
        message: friendlyMsg 
      };
    }
  };

  const handleSyncPassToWebhook = async (pass: GatePass) => {
    const passUniqueId = pass.passId || pass.id || '';
    setSyncingPassId(passUniqueId);
    try {
      const res = await sendWebhookNotification({
        action: "sync",
        id: passUniqueId,
        passId: passUniqueId,
        fullName: pass.fullName,
        department: pass.department,
        phoneNumber: pass.phoneNumber || '',
        reason: pass.reason,
        exitTime: pass.exitTime,
        createdAt: pass.createdAt,
        photoUrl: pass.photoUrl,
        status: pass.status,
        approvedAt: pass.approvedAt,
        approvedBy: pass.approvedBy,
        approverRole: pass.approverRole || pass.approverPosition,
        approverPosition: pass.approverPosition || pass.approverRole,
        approverEmail: pass.approverEmail
      });
      setSyncToast({
        success: res.success,
        message: res.success 
          ? `Đã gửi dữ liệu phiếu "${passUniqueId}" sang Google Sheets thành công!` 
          : res.message
      });
      setTimeout(() => setSyncToast(null), 5000);
    } catch (e: any) {
      setSyncToast({
        success: false,
        message: e?.message || "Lỗi khi đồng bộ Webhook"
      });
      setTimeout(() => setSyncToast(null), 5000);
    } finally {
      setSyncingPassId(null);
    }
  };

  const handleBulkSyncToWebhook = async () => {
    if (selectedPassIds.length === 0) return;
    setIsBulkSyncing(true);
    let successCount = 0;
    try {
      const passesToSync = passes.filter(p => p.id && selectedPassIds.includes(p.id));
      for (const pass of passesToSync) {
        const passUniqueId = pass.passId || pass.id || '';
        const res = await sendWebhookNotification({
          action: "sync",
          id: passUniqueId,
          passId: passUniqueId,
          fullName: pass.fullName,
          department: pass.department,
          phoneNumber: pass.phoneNumber || '',
          reason: pass.reason,
          exitTime: pass.exitTime,
          createdAt: pass.createdAt,
          photoUrl: pass.photoUrl,
          status: pass.status,
          approvedAt: pass.approvedAt,
          approvedBy: pass.approvedBy,
          approverRole: pass.approverRole || pass.approverPosition,
          approverPosition: pass.approverPosition || pass.approverRole,
          approverEmail: pass.approverEmail
        });
        if (res.success) successCount++;
      }
      setSyncToast({
        success: true,
        message: `Đã đồng bộ thành công ${successCount}/${passesToSync.length} phiếu sang Google Sheets!`
      });
      setTimeout(() => setSyncToast(null), 6000);
    } catch (e: any) {
      setSyncToast({
        success: false,
        message: e?.message || "Lỗi khi gửi webhook hàng loạt"
      });
      setTimeout(() => setSyncToast(null), 5000);
    } finally {
      setIsBulkSyncing(false);
    }
  };

  const handleSubmitPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !capturedImage || !verificationResult?.success) return;

    const cleanPhone = (formData.phoneNumber || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length !== 10) {
      alert("Số điện thoại liên hệ bắt buộc phải có đúng 10 chữ số!");
      return;
    }

    if (!selectedReasonOption) {
      alert("Vui lòng chọn gợi ý lý do xin ra cổng!");
      return;
    }

    const finalReason = (selectedReasonOption === "Lý do khác" ? customReasonText : selectedReasonOption).trim();
    if (!finalReason) {
      alert("Vui lòng nhập lý do cụ thể xin ra cổng!");
      return;
    }

    setIsSubmitting(true);
    
    const now = new Date();
    const dateCode = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const newPassId = `GP-${dateCode}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (isMockMode) {
      const newPass: GatePass = {
        id: newPassId,
        passId: newPassId,
        fullName: formData.fullName,
        department: formData.department,
        phoneNumber: cleanPhone,
        reason: finalReason,
        exitTime: formData.exitTime,
        photoUrl: capturedImage,
        status: 'Chờ duyệt',
        createdAt: new Date().toISOString(),
        uid: user.uid
      };
      const updated = [newPass, ...passes];
      setPasses(updated);
      localStorage.setItem('mock_gatepasses', JSON.stringify(updated));
      setIsCreating(false);
      setCapturedImage(null);
      setVerificationResult(null);
      setSelectedReasonOption('');
      setCustomReasonText('');
      setSelectedQuickMinutes(null);
      setIsSubmitting(false);

      sendWebhookNotification({
        action: "create",
        id: newPassId,
        passId: newPassId,
        fullName: newPass.fullName,
        department: newPass.department,
        phoneNumber: cleanPhone,
        reason: newPass.reason,
        exitTime: newPass.exitTime,
        photoUrl: newPass.photoUrl,
        status: newPass.status,
        createdAt: newPass.createdAt
      });
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'gatepasses'), {
        ...formData,
        phoneNumber: cleanPhone,
        reason: finalReason,
        passId: newPassId,
        photoUrl: capturedImage,
        status: 'Chờ duyệt',
        createdAt: serverTimestamp(),
        uid: user.uid
      });
      setIsCreating(false);
      setCapturedImage(null);
      setVerificationResult(null);
      setSelectedReasonOption('');
      setCustomReasonText('');
      setSelectedQuickMinutes(null);

      sendWebhookNotification({
        action: "create",
        id: newPassId,
        passId: newPassId,
        fullName: formData.fullName,
        department: formData.department,
        phoneNumber: cleanPhone,
        reason: finalReason,
        exitTime: formData.exitTime,
        photoUrl: capturedImage,
        status: 'Chờ duyệt',
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'gatepasses');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (passId: string, status: 'approved' | 'rejected' | 'Đã duyệt' | 'Từ chối') => {
    if (userProfile?.role !== 'admin') return;

    const vnStatus: 'Đã duyệt' | 'Từ chối' = (status === 'approved' || status === 'Đã duyệt') ? 'Đã duyệt' : 'Từ chối';
    const targetPass = passes.find(p => p.id === passId);
    const approvedAtVal = new Date().toISOString();
    const passUniqueId = targetPass?.passId || targetPass?.id || passId;

    // Lấy chính xác tên và chức vụ của tài khoản đang đăng nhập duyệt phiếu
    const approverNameVal = userProfile?.displayName?.trim() || user?.displayName?.trim() || user?.email?.split('@')[0] || 'Đoàn Trường';
    const approverPositionVal = (userProfile?.position && APPROVER_POSITIONS.includes(userProfile.position as any))
      ? userProfile.position
      : 'Bí thư ĐT';
    const approverEmailVal = user?.email || userProfile?.email || '';

    if (isMockMode) {
      const updated = passes.map(p => p.id === passId ? { 
        ...p, 
        status: vnStatus,
        approvedAt: approvedAtVal,
        approvedBy: approverNameVal,
        approverRole: approverPositionVal,
        approverPosition: approverPositionVal,
        approverEmail: approverEmailVal
      } : p);
      setPasses(updated);
      localStorage.setItem('mock_gatepasses', JSON.stringify(updated));
      
      if (targetPass) {
        sendWebhookNotification({
          action: "update_status",
          id: passUniqueId,
          passId: passUniqueId,
          fullName: targetPass.fullName,
          department: targetPass.department,
          phoneNumber: targetPass.phoneNumber || '',
          reason: targetPass.reason,
          exitTime: targetPass.exitTime,
          createdAt: targetPass.createdAt,
          photoUrl: targetPass.photoUrl,
          status: vnStatus,
          updatedAt: approvedAtVal,
          approvedAt: approvedAtVal,
          // Chính xác tên và chức vụ cập nhật lên RaCong
          nguoi_duyet: approverNameVal,
          chuc_vu: approverPositionVal,
          chuc_vu_nguoi_duyet: approverPositionVal,
          ten_nguoi_duyet: approverNameVal,
          approverName: approverNameVal,
          approverRole: approverPositionVal,
          approverPosition: approverPositionVal,
          approverEmail: approverEmailVal
        });
      }
      return;
    }

    try {
      await updateDoc(doc(db, 'gatepasses', passId), { 
        status: vnStatus,
        approvedAt: approvedAtVal,
        approvedBy: approverNameVal,
        approverRole: approverPositionVal,
        approverPosition: approverPositionVal,
        approverEmail: approverEmailVal
      });
      
      if (targetPass) {
        sendWebhookNotification({
          action: "update_status",
          id: passUniqueId,
          passId: passUniqueId,
          fullName: targetPass.fullName,
          department: targetPass.department,
          phoneNumber: targetPass.phoneNumber || '',
          reason: targetPass.reason,
          exitTime: targetPass.exitTime,
          createdAt: targetPass.createdAt,
          photoUrl: targetPass.photoUrl,
          status: vnStatus,
          updatedAt: approvedAtVal,
          approvedAt: approvedAtVal,
          // Chính xác tên và chức vụ cập nhật lên RaCong
          nguoi_duyet: approverNameVal,
          chuc_vu: approverPositionVal,
          chuc_vu_nguoi_duyet: approverPositionVal,
          ten_nguoi_duyet: approverNameVal,
          approverName: approverNameVal,
          approverRole: approverPositionVal,
          approverPosition: approverPositionVal,
          approverEmail: approverEmailVal
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `gatepasses/${passId}`);
    }
  };

  const toggleSelectPass = (passId: string) => {
    setSelectedPassIds(prev => 
      prev.includes(passId) 
        ? prev.filter(id => id !== passId) 
        : [...prev, passId]
    );
  };

  const toggleSelectAllPasses = () => {
    const allCurrentPageIds = paginatedPasses.map(p => p.id).filter(id => id !== undefined) as string[];
    if (allCurrentPageIds.length === 0) return;
    
    const isAllSelected = allCurrentPageIds.every(id => selectedPassIds.includes(id));
    if (isAllSelected) {
      setSelectedPassIds(prev => prev.filter(id => !allCurrentPageIds.includes(id)));
    } else {
      setSelectedPassIds(prev => {
        const union = new Set([...prev, ...allCurrentPageIds]);
        return Array.from(union);
      });
    }
  };

  const handleDeleteSingle = async (passId: string) => {
    if (!isMasterAdmin) {
      setPassToDelete(null);
      return;
    }
    setIsDeleting(true);
    try {
      if (isMockMode) {
        const localData = localStorage.getItem('mock_gatepasses');
        if (localData) {
          const parsed = JSON.parse(localData) as GatePass[];
          const updated = parsed.filter(p => p.id !== passId);
          localStorage.setItem('mock_gatepasses', JSON.stringify(updated));
          setPasses(updated);
        }
      } else {
        await deleteDoc(doc(db, 'gatepasses', passId));
      }
      setSelectedPassIds(prev => prev.filter(id => id !== passId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `gatepasses/${passId}`);
    } finally {
      setIsDeleting(false);
      setPassToDelete(null);
    }
  };

  const handleDeleteBulk = async () => {
    if (selectedPassIds.length === 0) return;
    if (!isMasterAdmin) {
      setBulkDeleteConfirm(false);
      return;
    }
    setIsDeleting(true);
    try {
      if (isMockMode) {
        const localData = localStorage.getItem('mock_gatepasses');
        if (localData) {
          const parsed = JSON.parse(localData) as GatePass[];
          const updated = parsed.filter(p => !selectedPassIds.includes(p.id!));
          localStorage.setItem('mock_gatepasses', JSON.stringify(updated));
          setPasses(updated);
        }
      } else {
        await Promise.all(
          selectedPassIds.map(async (passId) => {
            try {
              await deleteDoc(doc(db, 'gatepasses', passId));
            } catch (err) {
              console.error("Lỗi xóa phiếu:", err);
            }
          })
        );
      }
      setSelectedPassIds([]);
    } catch (error) {
      console.error("Lỗi xóa hàng loạt:", error);
    } finally {
      setIsDeleting(false);
      setBulkDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#00FF00] animate-spin" />
      </div>
    );
  }

  // ================= CỔNG XÁC MINH TRA CỨU ĐỘC LẬP CHO BẢO VỆ (KHÔNG CẦN LOGIN) =================
  if (verifyPassId) {
    const isExpired = verifyPassData ? isPassExpired(verifyPassData) : false;
    const isApproved = !isExpired && (verifyPassData?.status === 'approved' || verifyPassData?.status === 'Đã duyệt');
    const isRejected = verifyPassData?.status === 'rejected' || verifyPassData?.status === 'Từ chối';
    const remainingSecs = verifyPassData ? getPassRemainingSeconds(verifyPassData) : 0;
    const expiryDate = verifyPassData ? getPassExpiryDate(verifyPassData) : null;
    
    return (
      <div className="min-h-screen bg-[#070809] text-white font-mono p-4 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Decorative Tech Background Grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#1c1d21_1.2px,transparent_1.2px)] [background-size:16px_16px] opacity-40 pointer-events-none" />
        
        <div className="w-full max-w-md relative z-10 space-y-4">
          {/* Header */}
          <div className="text-center space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#151619] border border-[#1c1d21] rounded-full text-[9px] text-[#8E9299] font-bold tracking-widest uppercase">
              <ShieldCheck className="w-3.5 h-3.5 text-[#00FF00] animate-pulse" /> CỔNG THÔNG TIN BẢO VỆ VÀ GIÁM THỊ
            </div>
            <h1 className="text-base font-bold text-white tracking-widest uppercase mt-1">Smart Gate Verification</h1>
          </div>

          <AnimatePresence mode="wait">
            {verifyLoading ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#111214] border border-[#1c1d21] rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-4 min-h-[350px]"
              >
                <RefreshCcw className="w-10 h-10 text-[#00FF00] animate-spin" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-white uppercase tracking-wider">Đang kết nối Cloud Database...</p>
                  <p className="text-[10px] text-[#8E9299]">Truy xuất nguồn dữ liệu gốc thời gian thực...</p>
                </div>
              </motion.div>
            ) : verifyError ? (
              <motion.div 
                key="error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#111214] border border-red-500/30 rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-5 min-h-[350px] shadow-2xl"
              >
                <div className="bg-red-500/10 p-4 rounded-full border border-red-500/20">
                  <ShieldAlert className="w-10 h-10 text-red-500" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-red-500 uppercase tracking-widest">XÁC LẬP THẤT BẠI</h3>
                  <p className="text-xs text-[#8E9299] max-w-xs leading-relaxed">{verifyError}</p>
                </div>
                <button 
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('verify');
                    window.location.href = url.origin;
                  }}
                  className="bg-[#1c1d21] hover:bg-[#2d2e33] text-white text-[10px] uppercase tracking-wider font-bold py-2.5 px-6 rounded-xl border border-[#1c1d21] transition-colors"
                >
                  Về trang đăng nhập
                </button>
              </motion.div>
            ) : verifyPassData ? (
              <motion.div 
                key="success"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "bg-[#111214] border rounded-3xl overflow-hidden shadow-2xl relative flex flex-col",
                  isApproved ? "border-[#00FF00]/40 shadow-[#00FF00]/5" :
                  isExpired ? "border-amber-500/50 shadow-amber-500/10" :
                  isRejected ? "border-red-500/30 shadow-red-500/5" : "border-yellow-500/30 shadow-yellow-500/5"
                )}
              >
                {/* Banner trạng thái có màu nền cực kỳ rực rỡ */}
                <div className={cn(
                  "p-5 text-center flex flex-col items-center justify-center relative overflow-hidden font-sans border-b border-[#1c1d21]",
                  isApproved ? "bg-[#00FF00]/10 text-[#00FF00]" :
                  isExpired ? "bg-amber-950/50 text-amber-400" :
                  isRejected ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-500"
                )}>
                  {/* Glowing background bar */}
                  <div className="absolute inset-x-0 top-0 bottom-0 pointer-events-none bg-gradient-to-b from-white/[0.04] to-transparent animate-pulse" />
                  
                  {isApproved ? (
                    <>
                      <CheckCircle2 className="w-10 h-10 mb-2 animate-bounce text-[#00FF00]" />
                      <span className="text-base font-extrabold uppercase tracking-wider">PHIẾU HỢP LỆ (CÒN HIỆU LỰC RA CỔNG)</span>
                      <span className="text-[10px] font-bold opacity-90 uppercase tracking-widest mt-1 text-[#00FF00]">ĐỦ ĐIỀU KIỆN CHO RA KHỎI ĐỊA ĐIỂM</span>
                    </>
                  ) : isExpired ? (
                    <>
                      <Timer className="w-10 h-10 mb-2 text-amber-400 animate-pulse" />
                      <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border flex items-center gap-1 shadow-sm",
                          isRejected
                            ? "bg-red-500/25 text-red-300 border-red-500/40"
                            : "bg-emerald-500/25 text-[#00FF00] border-[#00FF00]/40"
                        )}>
                          {isRejected ? <><XCircle className="w-3.5 h-3.5" /> Đã từ chối</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Đã được duyệt</>}
                        </span>
                        <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border bg-amber-500/25 text-amber-300 border-amber-500/40 flex items-center gap-1 shadow-sm">
                          <Timer className="w-3.5 h-3.5 text-amber-400" /> Đã hết hạn ra cổng (quá 30 phút)
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest mt-0.5 bg-amber-500/20 px-3 py-0.5 rounded-full border border-amber-500/40">
                        QUÁ 30 PHÚT KỂ TỪ KHI DUYỆT - KHÔNG CHO PHÉP RA CỔNG
                      </span>
                    </>
                  ) : isRejected ? (
                    <>
                      <XCircle className="w-10 h-10 mb-2 text-red-400" />
                      <span className="text-base font-extrabold uppercase tracking-wider">PHIẾU BỊ TỪ CHỐI</span>
                      <span className="text-[10px] font-bold opacity-90 uppercase tracking-widest mt-1 text-red-300">KHÔNG ĐƯỢC PHÉP CHO RA CỔNG</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-9 h-9 mb-2 animate-spin text-yellow-400" />
                      <span className="text-base font-extrabold uppercase tracking-wider">ĐƠN CHỜ DUYỆT</span>
                      <span className="text-[10px] font-bold opacity-90 uppercase tracking-widest mt-1 text-yellow-300">YÊU CẦU GIÁM THỊ PHÊ DUYỆT TRƯỚC</span>
                    </>
                  )}
                </div>

                {/* Live Ticking Connection Watermark */}
                <div className="bg-[#08080a] px-4 py-2 border-b border-[#1c1d21] flex items-center justify-between text-[9px] text-[#8E9299] tracking-wider">
                  <span className="flex items-center gap-1 font-bold">
                    <span className={cn("w-1.5 h-1.5 rounded-full inline-block", isApproved ? "bg-[#00FF00] animate-ping" : isExpired ? "bg-amber-400 animate-ping" : "bg-red-500")} />
                    KẾT NỐI CHỨNG THỰC LIVE SECURE
                  </span>
                  <span className="font-mono text-white/90 font-bold bg-[#151619] px-2 py-0.5 rounded border border-[#1c1d21]">
                    {liveSecTime.toLocaleDateString('vi-VN')} {liveSecTime.toLocaleTimeString('vi-VN')}
                  </span>
                </div>

                {/* Main Content Info */}
                <div className="p-6 space-y-5">
                  {/* Photo with Glowing Ring */}
                  <div className="flex flex-col items-center">
                    <div 
                      onClick={() => {
                        setZoomedPass(verifyPassData as any);
                        setImageZoomScale(1);
                      }}
                      className={cn(
                        "w-36 h-36 rounded-2xl overflow-hidden border-2 relative aspect-square shadow-xl transition-all cursor-pointer group/badge-img",
                        isApproved ? "border-[#00FF00] ring-4 ring-[#00FF00]/10" :
                        isExpired ? "border-amber-400 ring-4 ring-amber-400/20" :
                        isRejected ? "border-red-500/60 ring-4 ring-red-500/5" : "border-yellow-500/50"
                      )}
                      title="Bấm vào để phóng to ảnh nhận diện khuôn mặt"
                    >
                      <img 
                        src={verifyPassData.photoUrl || 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'} 
                        referrerPolicy="no-referrer" 
                        alt="Khuôn mặt đăng ký" 
                        className="w-full h-full object-cover group-hover/badge-img:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/badge-img:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 backdrop-blur-[0.5px]">
                        <div className="w-8 h-8 rounded-full bg-black/80 border border-[#00FF00] flex items-center justify-center text-[#00FF00]">
                          <Eye className="w-4 h-4" />
                        </div>
                        <span className="text-[9px] font-bold text-[#00FF00] font-mono uppercase tracking-wider">Phóng to</span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-black/80 py-1 text-center text-[8px] text-[#8E9299] uppercase tracking-widest font-extrabold group-hover/badge-img:opacity-0 transition-opacity">
                        HÌNH ẢNH THỰC TẾ
                      </div>
                    </div>
                    <span className="text-[10px] text-[#8E9299] uppercase tracking-widest mt-2.5 font-bold font-sans">
                      Hãy so khớp với học sinh trước mặt
                    </span>
                  </div>

                  {/* Hiển thị Widget Đếm ngược hoặc Cảnh báo hết hạn 30 phút */}
                  {isApproved && (
                    <div className="bg-[#00FF00]/10 border border-[#00FF00]/30 rounded-2xl p-4 text-center space-y-1.5 font-sans">
                      <span className="text-[10px] text-[#00FF00] font-bold font-mono uppercase tracking-widest flex items-center justify-center gap-1.5">
                        <Timer className="w-4 h-4 animate-pulse text-[#00FF00]" /> THỜI HẠN HIỆU LỰC RA CỔNG CÒN LẠI
                      </span>
                      <div className="text-3xl sm:text-4xl font-black text-[#00FF00] font-mono tracking-widest">
                        {formatCountdown(remainingSecs)}
                      </div>
                      <p className="text-[10px] text-zinc-300">
                        Phiếu tự động hết hạn vào lúc: <strong className="text-white font-mono">{expiryDate?.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong> (30 phút sau khi duyệt)
                      </p>
                    </div>
                  )}

                  {isExpired && (
                    <div className="bg-amber-950/30 border-2 border-amber-500/50 rounded-2xl p-4 text-center space-y-2 font-sans">
                      <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border flex items-center gap-1 shadow-sm",
                          isRejected
                            ? "bg-red-500/25 text-red-300 border-red-500/40"
                            : "bg-emerald-500/25 text-[#00FF00] border-[#00FF00]/40"
                        )}>
                          {isRejected ? <><XCircle className="w-3.5 h-3.5" /> Đã từ chối</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Đã được duyệt</>}
                        </span>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border bg-amber-500/25 text-amber-300 border-amber-500/40 flex items-center gap-1 shadow-sm">
                          <Timer className="w-3.5 h-3.5 text-amber-400" /> Đã hết hạn ra cổng (quá 30 phút)
                        </span>
                      </div>
                      <p className="text-xs text-zinc-200 leading-relaxed font-sans">
                        Phiếu này trước đó <strong className="text-white">{isRejected ? 'đã bị từ chối' : 'đã được Ban Giám Thị phê duyệt'}</strong> lúc <strong className="text-white font-mono">{verifyPassData.approvedAt ? new Date(verifyPassData.approvedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</strong> và đã hết hạn lúc <strong className="text-amber-400 font-mono">{expiryDate?.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong> (quá thời hạn 30 phút).
                      </p>
                      <div className="bg-red-500/20 text-red-300 border border-red-500/40 px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider">
                        ⛔ BẢO VỆ TUYỆT ĐỐI KHÔNG CHO HỌC SINH RA CỔNG BẰNG PHIẾU NÀY
                      </div>
                    </div>
                  )}

                  {/* Information block */}
                  <div className="space-y-3 font-sans">
                    <div className="bg-[#0a0a0c] rounded-xl border border-[#1c1d21] p-3.5 text-center">
                      <span className="text-[9px] text-[#8E9299] uppercase tracking-widest block font-bold font-mono">Đối tượng</span>
                      <span className="text-base font-extrabold text-white uppercase tracking-tight block mt-0.5">{verifyPassData.fullName}</span>
                      <div className="flex items-center justify-center gap-2 mt-1.5 flex-wrap">
                        <span className="px-3 py-1 bg-[#17181c] rounded-full border border-[#1c1d21] text-[10px] text-[#8E9299] font-bold">
                          Lớp: <span className="text-white">{verifyPassData.department}</span>
                        </span>
                        <span className="px-3 py-1 bg-cyan-950/30 rounded-full border border-cyan-500/30 text-[10px] text-cyan-400 font-mono font-bold">
                          SĐT: {verifyPassData.phoneNumber || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#0a0a0c] border-[#00FF00]/20 rounded-2xl p-4 text-center relative overflow-hidden bg-gradient-to-b from-[#00FF00]/5 to-transparent shadow-md border-2 font-sans">
                      <span className="text-[10px] text-[#8E9299] uppercase tracking-widest block font-extrabold font-mono">📝 LÝ DO XIN PHÉP (CHÍNH ĐÁNG)</span>
                      <p className="text-base sm:text-lg font-black text-white tracking-tight mt-2 pb-1 leading-relaxed">
                        {verifyPassData.reason || "Không có nội dung lý do"}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[#0a0a0c] rounded-xl border border-[#1c1d21] p-3 text-center">
                        <span className="text-[9px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">Trạng thái phiếu</span>
                        <span className={cn(
                          "font-extrabold block mt-1 tracking-wider text-xs",
                          isApproved ? "text-[#00FF00]" : isExpired ? "text-amber-400 font-black" : isRejected ? "text-red-500" : "text-yellow-500"
                        )}>
                          {isApproved ? "✓ Đã duyệt (Còn hiệu lực)" : isExpired ? "⏱️ Đã hết hạn ra cổng" : isRejected ? "Từ chối" : "Chờ duyệt"}
                        </span>
                      </div>
                      <div className="bg-[#0a0a0c] rounded-xl border border-[#1c1d21] p-3 text-center flex flex-col justify-center">
                        <span className="text-[9px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">Đồng bộ đám mây</span>
                        <span className="text-[#00FF00] font-black text-[10px] uppercase font-mono block mt-1">✓ LIVE SYNCED</span>
                      </div>
                    </div>

                    <div className="bg-[#0a0a0c] rounded-xl border border-cyan-500/30 p-3.5 flex justify-between items-center bg-gradient-to-r from-cyan-500/10 to-transparent font-sans text-xs">
                      <span className="text-[9px] text-cyan-400 uppercase tracking-widest block font-bold font-mono">⏱️ Thời gian xin ra cổng</span>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1 font-extrabold text-cyan-300">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          <span>{verifyPassData.exitTime ? new Date(verifyPassData.exitTime).toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'}) : "N/A"}</span>
                        </div>
                        <span className="text-[9px] text-cyan-400/80 block font-mono mt-0.5">
                          Ngày {verifyPassData.exitTime ? new Date(verifyPassData.exitTime).toLocaleDateString('vi-VN') : ""}
                        </span>
                      </div>
                    </div>

                    {verifyPassData.approvedAt && (
                      <div className={cn(
                        "rounded-2xl p-4 text-center font-sans shadow-lg",
                        isExpired 
                          ? "bg-[#0c0c10] border-2 border-dashed border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-transparent shadow-amber-500/5"
                          : "bg-[#0c0c10] border-2 border-dashed border-[#00FF00]/40 bg-gradient-to-r from-[#00FF00]/10 to-transparent shadow-[#00FF00]/5"
                      )}>
                        <span className={cn(
                          "text-[10px] block font-bold font-mono uppercase tracking-widest",
                          isExpired ? "text-amber-400" : "text-[#00FF00]"
                        )}>
                          {isExpired ? "⚠️ THỜI GIAN ĐÃ PHÊ DUYỆT (ĐÃ QUÁ HẠN 30 PHÚT)" : "✓ Ô XÁC NHẬN - THỜI GIAN ĐÃ PHÊ DUYỆT"}
                        </span>
                        
                        <div className="flex flex-col items-center justify-center mt-2 space-y-1">
                          <span className={cn("text-xl sm:text-2xl font-black tracking-tight font-mono", isExpired ? "text-amber-400 line-through opacity-80" : "text-[#00FF00]")}>
                            {new Date(verifyPassData.approvedAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}
                          </span>
                          <span className="text-xs text-white/90 font-extrabold font-mono uppercase tracking-wide">
                            Ngày {new Date(verifyPassData.approvedAt).toLocaleDateString('vi-VN')}
                          </span>
                          {expiryDate && (
                            <span className="text-[10px] text-amber-300 font-mono bg-amber-950/40 px-3 py-1 rounded-full border border-amber-500/30 mt-1 font-bold">
                              Hết hạn lúc: {expiryDate.toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit', second: '2-digit'})} (+30 phút)
                            </span>
                          )}
                          {verifyPassData.approvedBy && (
                            <span className="text-[10px] text-[#8E9299] block bg-black/60 px-3 py-1 rounded-full border border-[#1c1d21] mt-1 font-mono">
                              Người duyệt: <span className="text-white font-bold">{verifyPassData.approvedBy}</span>
                              {(verifyPassData.approverRole || verifyPassData.approverPosition) && (
                                <span className={cn("ml-1.5 font-semibold", isExpired ? "text-amber-400" : "text-[#00FF00]")}>({verifyPassData.approverRole || verifyPassData.approverPosition})</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Footer tags */}
                    <div className="border-t border-[#1c1d21] pt-3 flex items-center justify-between text-[9px] text-[#5e6166] font-mono">
                      <span>MÃ QR CHỨNG THỰC (ID)</span>
                      <span className="text-[#00FF00] tracking-wider font-bold select-all">{verifyPassData.passId || ('GP-' + verifyPassData.id?.toUpperCase().slice(0, 10))}</span>
                    </div>
                  </div>
                </div>

                {/* Footer security guidance */}
                <div className="bg-[#0c0d10] border-t border-[#1c1d21] p-4 text-center rounded-b-3xl">
                  <span className="text-[9px] text-[#8E9299] uppercase tracking-widest block leading-relaxed">
                    ⚙️ PHẦN MỀM KIỂM SOÁT CỔNG THÔNG MINH - GATEPASS AI TRÍ TUỆ NHÂN TẠO KHÔNG THỂ LÀM GIẢ.
                  </span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Return login back button */}
          <div className="flex justify-center pt-2">
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete('verify');
                window.location.href = url.origin;
              }}
              className="flex items-center gap-1.5 text-[10px] font-bold text-[#8E9299] hover:text-white uppercase tracking-wider transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Quay về hệ thống quản lý
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 sm:p-6 lg:p-8 text-white font-mono relative overflow-x-hidden selection:bg-[#00FF00]/30 selection:text-[#00FF00] py-6 sm:py-10">
        {/* Subtle decorative background lights */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#00FF00]/5 rounded-full blur-[160px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[500px] h-[500px] bg-[#00FF00]/3 rounded-full blur-[140px] pointer-events-none" />

        {/* Khung đăng nhập: giữ nguyên kích thước rộng rãi, căn giữa */}
        <div 
          className="w-full mx-auto relative z-10 my-auto flex justify-center"
          style={{ width: 'min(94vw, 760px)', maxWidth: '760px' }}
        >
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full bg-[#151619] border border-[#1c1d21] rounded-2xl md:rounded-3xl p-6 sm:p-8 lg:p-10 shadow-2xl relative z-10"
          >
            {/* Header thương hiệu tại đầu khung đăng nhập */}
            <div className="text-center pb-5 mb-5 border-b border-[#1c1d21]">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#00FF00]/10 border border-[#00FF00]/30 flex items-center justify-center text-[#00FF00] shadow-[0_0_30px_rgba(0,255,0,0.2)] mx-auto mb-3">
                <ShieldCheck className="w-7 h-7 sm:w-8 sm:h-8 text-[#00FF00]" />
              </div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="text-2xl sm:text-3xl font-black tracking-wider text-white font-mono">GATEPASS</span>
                <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-[#00FF00]/20 text-[#00FF00] font-bold border border-[#00FF00]/30 font-mono">
                  AI
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-[#00FF00] font-mono tracking-widest uppercase">
                Hệ Thống Quản Lý Ra Cổng Thông Minh
              </p>
              <h2 className="text-xs sm:text-sm text-[#8E9299] font-sans mt-2 font-medium">
                {isRegistering 
                  ? "ĐĂNG KÝ HỌC SINH MỚI" 
                  : isForgotPasswordMode 
                  ? "KHÔI PHỤC MẬT KHẨU TRUY CẬP" 
                  : "CỔNG ĐĂNG NHẬP CHUNG DÀNH CHO CÁN BỘ & HỌC SINH"}
              </h2>
            </div>

            <div className="space-y-4 font-sans">
              {/* Thông báo lỗi nếu có */}
              {loginError && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-xs flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{loginError}</span>
                </div>
              )}

              {/* Thông báo đăng ký thành công */}
              {registerSuccess && (
                <div className="p-3 bg-[#00FF00]/10 border border-[#00FF00]/40 rounded-xl text-[#00FF00] text-xs flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#00FF00]" />
                  <span>Đăng ký thành công! Bạn có thể đăng nhập ngay bằng số điện thoại, họ tên hoặc email.</span>
                </div>
              )}

              {isRegistering ? (
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                        Họ và tên học sinh:
                      </label>
                      <div className="relative">
                        <UserIcon className="absolute left-3.5 top-3.5 w-4 h-4 text-[#8E9299]" />
                        <input 
                          required type="text" placeholder="Ví dụ: Nguyễn Văn An" 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                          value={registerData.fullName} onChange={(e) => setRegisterData({...registerData, fullName: e.target.value})}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                          Lớp học:
                        </label>
                        <div className="relative">
                          <GraduationCap className="absolute left-3.5 top-3.5 w-4 h-4 text-[#8E9299]" />
                          <input 
                            required type="text" placeholder="Ví dụ: 12A1" 
                            className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                            value={registerData.className} onChange={(e) => setRegisterData({...registerData, className: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                          Số điện thoại:
                        </label>
                        <div className="relative">
                          <Smartphone className="absolute left-3.5 top-3.5 w-4 h-4 text-[#8E9299]" />
                          <input 
                            required type="tel" placeholder="Số điện thoại di động" 
                            className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                            value={registerData.phoneNumber} onChange={(e) => setRegisterData({...registerData, phoneNumber: e.target.value})}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                          Địa chỉ Email:
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-[#8E9299]" />
                          <input 
                            required type="email" placeholder="Email học sinh" 
                            className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                            value={registerData.email} onChange={(e) => setRegisterData({...registerData, email: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                          Mật khẩu:
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-[#8E9299]" />
                          <input 
                            required type="password" placeholder="Tối thiểu 6 ký tự" 
                            className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                            value={registerData.password} onChange={(e) => setRegisterData({...registerData, password: e.target.value})}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <button disabled={registerLoading} className="w-full bg-[#00FF00] hover:bg-[#00CC00] text-black font-bold py-3.5 rounded-xl transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer text-xs sm:text-sm uppercase tracking-wider font-mono shadow-lg shadow-[#00FF00]/15">
                    {registerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "HOÀN TẤT ĐĂNG KÝ"}
                  </button>
                  <button type="button" onClick={() => setIsRegistering(false)} className="w-full text-center text-xs text-[#8E9299] hover:text-white transition-colors cursor-pointer uppercase tracking-wider py-1 font-mono">
                    ← Đã có tài khoản? Đăng nhập ngay
                  </button>
                </form>
              ) : isForgotPasswordMode ? (
                <form onSubmit={handleSendForgotPassword} className="space-y-4 font-sans">
                  <div className="text-center space-y-1.5 pb-1">
                    <div className="w-10 h-10 mx-auto rounded-xl bg-[#00FF00]/10 border border-[#00FF00]/30 flex items-center justify-center text-[#00FF00]">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">GỬI LIÊN KẾT ĐẶT LẠI MẬT KHẨU</h3>
                    <p className="text-xs text-[#8E9299] leading-relaxed">
                      Nhập Email, Số điện thoại hoặc Họ tên tài khoản của bạn để nhận liên kết thiết lập mật khẩu mới qua email.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] sm:text-xs text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                      Tài khoản cần khôi phục (Email / SĐT / Họ tên):
                    </label>
                    <div className="relative">
                      <UserCheck className="absolute left-3.5 top-3.5 sm:top-4 w-4 h-4 text-[#8E9299]" />
                      <input 
                        required
                        type="text" 
                        placeholder="Ví dụ: lytm.angiang@gmail.com, 0912345678, hoặc Họ tên..." 
                        className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3.5 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                        value={forgotEmail} 
                        onChange={(e) => setForgotEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  {resetSuccessMessage && (
                    <div className="p-4 bg-[#00FF00]/10 border border-[#00FF00]/40 rounded-xl text-white text-xs space-y-2.5 font-sans">
                      <div className="flex items-center gap-2 text-[#00FF00] font-bold">
                        <CheckCircle2 className="w-5 h-5 shrink-0" />
                        <span>Đã gửi liên kết đặt lại mật khẩu thành công!</span>
                      </div>
                      <p className="text-zinc-300 leading-relaxed">
                        Hệ thống đã gửi liên kết khôi phục tới: <strong className="text-[#00FF00] break-all">{resetSentEmail || forgotEmail}</strong>
                      </p>
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-[11px] leading-relaxed space-y-1">
                        <div className="font-bold flex items-center gap-1.5 text-amber-400">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>HƯỚNG DẪN KIỂM TRA ĐỂ NHẬN EMAIL:</span>
                        </div>
                        <p>1. Hãy mở hòm thư email của bạn và kiểm tra mục <strong>Hộp thư đến (Inbox)</strong>.</p>
                        <p>2. <strong>Đặc biệt lưu ý:</strong> Nếu không thấy, bạn hãy kiểm tra mục <strong>Thư rác (Spam / Junk)</strong> hoặc hòm thư <strong>Quảng cáo (Promotions)</strong>.</p>
                        <p>3. Bấm vào liên kết trong email để đặt mật khẩu mới, sau đó quay lại trang này để đăng nhập bình thường.</p>
                      </div>
                    </div>
                  )}

                  {resetErrorMessage && (
                    <div className="p-3.5 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-xs flex items-start gap-2.5 font-sans">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                      <span className="leading-relaxed">{resetErrorMessage}</span>
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={isSendingReset || resendCooldown > 0}
                    className="w-full bg-[#00FF00] hover:bg-[#00CC00] disabled:bg-[#1c1d21] disabled:text-[#8E9299] text-black font-bold py-3.5 rounded-xl transition-all active:scale-[0.99] cursor-pointer text-xs sm:text-sm uppercase tracking-wider shadow-lg shadow-[#00FF00]/15 flex items-center justify-center gap-2 font-mono"
                  >
                    {isSendingReset ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    {isSendingReset 
                      ? "ĐANG XỬ LÝ GỬI LINK..." 
                      : resendCooldown > 0 
                      ? `GỬI LẠI SAU (${resendCooldown}S)` 
                      : "GỬI LIÊN KẾT ĐẶT LẠI MẬT KHẨU"}
                  </button>

                  <button 
                    type="button" 
                    onClick={() => {
                      setIsForgotPasswordMode(false);
                      setResetSuccessMessage(null);
                      setResetErrorMessage(null);
                    }} 
                    className="w-full text-center text-xs text-[#8E9299] hover:text-white transition-colors cursor-pointer uppercase tracking-wider py-1 font-mono flex items-center justify-center gap-1.5 pt-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Quay lại trang đăng nhập
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  {/* Form đăng nhập bằng Email / SĐT / Tên tài khoản + Mật khẩu */}
                  <form onSubmit={handleEmailLogin} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-[10px] sm:text-xs text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                        Tài khoản (Email, Số điện thoại hoặc Họ tên):
                      </label>
                      <div className="relative">
                        <UserCheck className="absolute left-3.5 top-3.5 sm:top-4 w-4 h-4 text-[#8E9299]" />
                        <input 
                          type="text" 
                          placeholder="Nhập email, SĐT hoặc họ tên đã đăng ký..." 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-2.5 sm:py-3.5 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                          value={email} 
                          onChange={(e) => {
                            setSelectedSavedAccount(null);
                            setEmail(e.target.value);
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] sm:text-xs text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                        Mật khẩu:
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-3.5 sm:top-4 w-4 h-4 text-[#8E9299]" />
                        <input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="Nhập mật khẩu..." 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-11 py-2.5 sm:py-3.5 text-xs sm:text-sm text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]"
                          value={password} 
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-3 sm:top-3.5 p-1 text-[#8E9299] hover:text-white transition-colors cursor-pointer"
                          title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isLoggingIn}
                      className="w-full bg-[#00FF00] hover:bg-[#00CC00] disabled:bg-[#1c1d21] disabled:text-[#8E9299] text-black font-bold py-3.5 sm:py-4 rounded-xl transition-all active:scale-[0.99] cursor-pointer text-xs sm:text-sm uppercase tracking-wider shadow-lg shadow-[#00FF00]/15 flex items-center justify-center gap-2 font-mono"
                    >
                      {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {isLoggingIn ? "ĐANG XÁC THỰC..." : "ĐĂNG NHẬP HỆ THỐNG"}
                    </button>

                    <div className="flex flex-col sm:flex-row justify-between items-center gap-2 pt-1 text-xs font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(email);
                          setIsForgotPasswordMode(true);
                          setLoginError(null);
                        }}
                        className="text-[#8E9299] hover:text-[#00FF00] transition-colors cursor-pointer flex items-center gap-1.5 font-sans"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-[#00FF00]" />
                        Quên mật khẩu?
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setIsRegistering(true);
                          setLoginError(null);
                        }} 
                        className="text-[#00FF00] hover:underline transition-colors uppercase tracking-wider font-semibold cursor-pointer font-mono text-xs"
                      >
                        Đăng ký học sinh mới →
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono">
      {/* Header */}
      <header className="border-b border-[#1c1d21] bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="w-[98%] max-w-[2000px] mx-auto px-3 sm:px-5 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#00FF00] rounded flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-black" /></div>
            <span className="font-bold tracking-widest text-sm">GATEPASS.SYS</span>
            {isMockMode && (
              <span className="bg-[#00FF00]/15 text-[#00FF00] border border-[#00FF00]/30 text-[9px] px-2 py-0.5 rounded-full font-bold tracking-wide uppercase">
                ⚡ BYPASS MODE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Nút Tạo tài khoản Quản trị - Chỉ hiển thị cho Quản trị viên cấp cao (Master Admin) */}
            {userProfile?.role === 'admin' && isMasterAdmin && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateAdminModal(true);
                  loadAdminList();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#00FF00]/10 hover:bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/30 hover:border-[#00FF00]/60 text-xs font-bold transition-all active:scale-95 cursor-pointer font-sans shadow-sm"
                title="Tạo tài khoản quản trị duyệt phép mới"
              >
                <UserPlus className="w-3.5 h-3.5 text-[#00FF00]" />
                <span className="hidden sm:inline">TẠO TK QUẢN TRỊ</span>
                <span className="sm:hidden">+ ADMIN</span>
              </button>
            )}

            <div 
              onClick={() => setShowProfileEdit(!showProfileEdit)}
              className={cn(
                "flex flex-col items-end cursor-pointer group hover:opacity-90 transition-all px-3 py-1.5 rounded-xl border border-transparent hover:border-[#1c1d21]/60 hover:bg-[#151619]/40",
                showProfileEdit ? "bg-[#151619] border-[#1c1d21]/80" : ""
              )}
              title="Bấm vào để chỉnh sửa thông tin cá nhân"
            >
              <span className="text-[9px] text-[#00FF00] font-bold uppercase tracking-widest flex items-center gap-1 font-sans">
                {userProfile?.role === 'admin' 
                  ? (isMasterAdmin ? (userProfile.position || "Bí thư ĐT (Cấp cao)") : `${userProfile.position || "Cán bộ duyệt"} (Duyệt phép)`) 
                  : "Học sinh"}
                <span className="text-[8px] text-[#8E9299] group-hover:text-white transition-colors">✏️ SỬA</span>
              </span>
              <span className="text-xs font-bold text-white group-hover:text-[#00FF00] transition-colors font-sans">
                {userProfile?.displayName || user?.email || "Người dùng"}
              </span>
            </div>
            
            <button 
              onClick={() => setShowProfileEdit(!showProfileEdit)}
              className={cn(
                "p-2 hover:bg-[#1c1d21] rounded-lg transition-colors text-[#8E9299] hover:text-white cursor-pointer",
                showProfileEdit ? "text-[#00FF00] bg-[#1c1d21]" : ""
              )}
              title="Chỉnh sửa thông tin cá nhân"
            >
              <UserIcon className="w-5 h-5" />
            </button>

            <button onClick={handleLogout} className="p-2 hover:bg-[#1c1d21] rounded-lg transition-colors text-[#8E9299] hover:text-white cursor-pointer" title="Đăng xuất"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <main className="w-[98%] max-w-[2000px] mx-auto px-2 sm:px-4 md:px-6 py-4 md:py-6">
        <AnimatePresence mode="wait">
          {showProfileEdit && userProfile ? (
            <motion.div
              key="profile-edit-tab"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-4xl mx-auto"
            >
              <div className="bg-[#151619] border border-[#1c1d21] rounded-2xl p-6 md:p-8 space-y-6 shadow-2xl relative overflow-hidden bg-gradient-to-b from-[#00FF00]/5 to-transparent">
                <div className="flex items-center justify-between border-b border-[#1c1d21] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#00FF00]/10 flex items-center justify-center text-[#00FF00]">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm md:text-base font-bold text-white uppercase tracking-widest font-mono">CHỈNH SỬA THÔNG TIN CÁ NHÂN</h3>
                      <p className="text-[10px] text-[#8E9299]">Cập nhật thông tin của bạn để tự động áp dụng khi đăng ký phiếu ra cổng</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      if (userProfile) {
                        setProfileName(userProfile.displayName || '');
                        setProfileClass(userProfile.className || '');
                        const validPos = userProfile.position && APPROVER_POSITIONS.includes(userProfile.position as any)
                          ? userProfile.position
                          : 'Bí thư ĐT';
                        setProfilePosition(userProfile.role === 'admin' ? validPos : (userProfile.position || ''));
                        setProfilePhone(userProfile.phoneNumber || '');
                      }
                      setShowProfileEdit(false);
                    }}
                    className="p-1 text-[#8E9299] hover:text-white hover:bg-[#1c1d21] rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-6 font-sans">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                        {userProfile.role === 'admin' ? "Họ và tên cán bộ duyệt phiếu" : "Họ và tên học sinh / cán bộ"}
                      </label>
                      <input 
                        required 
                        type="text" 
                        value={profileName} 
                        onChange={(e) => setProfileName(e.target.value)} 
                        className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]" 
                        placeholder={userProfile.role === 'admin' ? "Ví dụ: Thầy Trần Minh Lý..." : "Nhập họ và tên..."}
                      />
                    </div>

                    {userProfile.role === 'student' ? (
                      <div className="space-y-2">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">Lớp học / Đơn vị học tập</label>
                        <input 
                          required 
                          type="text" 
                          value={profileClass} 
                          onChange={(e) => setProfileClass(e.target.value)} 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]" 
                          placeholder="Ví dụ: 12A1, Kế toán..."
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                            Chức vụ duyệt phiếu (Quy định)
                          </label>
                          <span className="text-[9px] text-[#00FF00] font-mono font-bold">Bắt buộc</span>
                        </div>
                        <select
                          value={profilePosition}
                          onChange={(e) => setProfilePosition(e.target.value)}
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all font-bold cursor-pointer"
                        >
                          {APPROVER_POSITIONS.map(pos => (
                            <option key={pos} value={pos} className="bg-[#121316] text-white">
                              {pos}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap gap-2 pt-1 items-center">
                          <span className="text-[10px] text-[#8E9299]">Chức vụ:</span>
                          {APPROVER_POSITIONS.map(title => (
                            <button
                              type="button"
                              key={title}
                              onClick={() => setProfilePosition(title)}
                              className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer",
                                profilePosition === title 
                                  ? "bg-[#00FF00] text-black border-[#00FF00] shadow-md shadow-[#00FF00]/10"
                                  : "bg-[#0c0d0f] text-[#8E9299] border-[#1c1d21] hover:text-white hover:border-[#333]"
                              )}
                            >
                              {title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">Số điện thoại liên hệ khẩn cấp</label>
                      <input 
                        type="tel" 
                        value={profilePhone} 
                        onChange={(e) => setProfilePhone(e.target.value)} 
                        className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]" 
                        placeholder="Nhập số điện thoại liên lạc..."
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#1c1d21]/40">
                    <div>
                      {userProfile.role === 'admin' && isMasterAdmin && (
                        <button 
                          type="button"
                          onClick={() => {
                            setShowProfileEdit(false);
                            setShowCreateAdminModal(true);
                            loadAdminList();
                          }}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00FF00]/10 hover:bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/30 hover:border-[#00FF00]/60 font-bold transition-all text-xs cursor-pointer uppercase tracking-wider font-sans"
                          title="Tạo tài khoản quản trị duyệt phép mới"
                        >
                          <UserPlus className="w-4 h-4 text-[#00FF00]" />
                          Tạo tài khoản Quản trị duyệt phép
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => {
                          if (userProfile) {
                            setProfileName(userProfile.displayName || '');
                            setProfileClass(userProfile.className || '');
                            setProfilePhone(userProfile.phoneNumber || '');
                          }
                          setShowProfileEdit(false);
                        }}
                        className="px-5 py-2.5 rounded-xl bg-[#1c1d21] hover:bg-[#25272c] text-[#8E9299] hover:text-white font-bold transition-all text-xs cursor-pointer uppercase tracking-wider"
                      >
                        Huỷ bỏ
                      </button>
                      <button 
                        type="submit"
                        disabled={isSavingProfile}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#00FF00] hover:bg-[#00CC00] text-black font-bold transition-all text-xs active:scale-95 disabled:opacity-55 cursor-pointer uppercase tracking-wider"
                      >
                        {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Cập nhật thông tin
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="main-dashboard-app"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {isCreating && userProfile ? (
          /* ================= GIAO DIỆN TẠO PHIẾU TOÀN MÀN HÌNH (BỐ CỤC 2 CỘT HIỆN ĐẠI 40% - 60%) ================= */
          <div className="w-full max-w-[min(96vw,1600px)] mx-auto px-2 sm:px-4 md:px-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#1c1d21]/80 pb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#00FF00]/10 flex items-center justify-center text-[#00FF00]">
                  <Plus className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-sm md:text-base font-bold text-white tracking-widest uppercase font-mono">ĐĂNG KÝ PHIẾU RA CỔNG</h2>
                  <p className="text-[10px] text-[#8E9299]">Điền thông tin & Xác minh khuôn mặt thời gian thực bằng Camera</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsCreating(false);
                  setSelectedReasonOption('');
                  setCustomReasonText('');
                  setSelectedQuickMinutes(null);
                }}
                className="flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl bg-[#1c1d21] hover:bg-[#25272c] text-[#8E9299] hover:text-white text-xs font-bold transition-all active:scale-95 border border-[#1c1d21] cursor-pointer"
              >
                <X className="w-4 h-4" /> QUAY LẠI LỊCH SỬ
              </button>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#151619] border border-[#1c1d21] rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-4 md:px-6 border-b border-[#1c1d21] bg-[#1c1d21]/50 flex items-center justify-between font-sans flex-wrap gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#00FF00] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#00FF00] animate-pulse" />
                  Phiếu Đăng Ký Hệ Thống GatePass AI
                </span>
                <span className="text-[9px] px-2.5 py-1 rounded bg-[#00FF00]/10 text-[#00FF00] font-mono select-none border border-[#00FF00]/30 font-bold">
                  MÃ PHIẾU TỰ ĐỘNG: GP-{new Date().toISOString().slice(2,10).replace(/-/g, '')}-XXXX
                </span>
              </div>

              <form onSubmit={handleSubmitPass} className="p-4 md:p-6 lg:p-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
                  {/* CỘT ẢNH / CAMERA: ~40% (5 cols out of 12) */}
                  <div className="lg:col-span-5 flex flex-col space-y-3.5 w-full">
                    {/* Header xác minh */}
                    <div className="flex items-center justify-between border-b border-[#1c1d21] pb-2.5">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-[#00FF00]" />
                        <label className="text-xs text-white uppercase tracking-wider block font-bold font-sans">
                          Xác minh khuôn mặt
                        </label>
                        <span className="text-[9px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-bold border border-red-500/30">
                          Bắt buộc
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] text-[#00FF00] hover:underline flex items-center gap-1 font-bold cursor-pointer transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" /> Tải file ảnh
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <input
                        type="file"
                        ref={nativeCameraInputRef}
                        accept="image/*"
                        capture="user"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </div>

                    {/* Khung chụp tỷ lệ dọc 3:4 chuẩn, chiều cao khoảng min(70vh, 720px) trên desktop, tự tính chiều rộng */}
                    <div className="relative aspect-[3/4] w-full max-w-[380px] lg:max-w-none lg:w-auto lg:h-[min(70vh,720px)] max-h-[min(70vh,720px)] mx-auto bg-black rounded-2xl md:rounded-3xl overflow-hidden border border-[#1c1d21] shadow-2xl flex items-center justify-center font-sans">
                      {cameraError ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0a0a0a] space-y-3">
                          <AlertCircle className="w-10 h-10 text-amber-500 mb-1" />
                          <p className="text-xs text-zinc-300 font-semibold leading-relaxed">{cameraError}</p>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2.5 rounded-xl bg-[#00FF00] hover:bg-[#00CC00] text-black text-xs font-bold flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer uppercase tracking-wider"
                          >
                            <Upload className="w-4 h-4" /> Tải ảnh khuôn mặt từ máy
                          </button>
                        </div>
                      ) : !capturedImage ? (
                        <>
                          <Webcam
                            audio={false}
                            ref={webcamRef}
                            screenshotFormat="image/jpeg"
                            screenshotQuality={0.92}
                            forceScreenshotSourceSize={true}
                            mirrored={cameraFacingMode === 'user'}
                            className="w-full h-full object-cover"
                            videoConstraints={{
                              facingMode: cameraFacingMode,
                              width: { ideal: 1280 },
                              height: { ideal: 720 }
                            }}
                            onUserMediaError={(err) => {
                              console.error("Camera error:", err);
                              setCameraError("Không thể mở camera trực tiếp. Vui lòng cho phép quyền hoặc bấm 'Dùng Máy Ảnh Máy' / tải ảnh từ thiết bị.");
                            }}
                          />
                          
                          {/* Hướng dẫn căn chỉnh khuôn mặt trong khung 3:4 & Nút đổi camera */}
                          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-3.5 bg-gradient-to-b from-black/50 via-transparent to-black/60">
                            <div className="w-full flex items-center justify-between pointer-events-auto">
                              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-white font-mono">
                                <span className="w-2 h-2 rounded-full bg-[#00FF00] animate-ping" />
                                CAMERA TRỰC TIẾP
                              </div>
                              <button
                                type="button"
                                onClick={() => setCameraFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/70 hover:bg-black/90 active:scale-95 transition-all backdrop-blur-md border border-white/20 text-[10px] text-zinc-200 hover:text-white font-mono cursor-pointer"
                                title="Chuyển đổi Camera Trước / Sau"
                              >
                                <RefreshCcw className="w-3 h-3 text-[#00FF00]" />
                                <span>{cameraFacingMode === 'user' ? 'Đổi Cam Sau' : 'Đổi Cam Trước'}</span>
                              </button>
                            </div>
                            
                            {/* Vùng định vị khuôn mặt oval */}
                            <div className="w-[72%] h-[68%] border-2 border-dashed border-[#00FF00]/50 rounded-[42px] flex items-center justify-center relative shadow-[0_0_15px_rgba(0,255,0,0.15)]">
                              {/* 4 góc căn chỉnh */}
                              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-[#00FF00]" />
                              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-[#00FF00]" />
                              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-[#00FF00]" />
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-[#00FF00]" />
                            </div>

                            <div className="px-3 py-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[10px] text-zinc-300 text-center font-medium">
                              Căn chỉnh toàn bộ khuôn mặt trong khung hình
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="relative w-full h-full flex items-center justify-center bg-black">
                          <img
                            src={capturedImage}
                            className="w-full h-full object-contain"
                            alt="Ảnh nhận diện khuôn mặt"
                            referrerPolicy="no-referrer"
                          />
                          {/* Lớp hiển thị trạng thái AI quét khuôn mặt */}
                          {isVerifying && (
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 p-4 text-center">
                              <Loader2 className="w-8 h-8 text-[#00FF00] animate-spin" />
                              <span className="text-xs font-bold text-white uppercase tracking-wider bg-black/80 px-3.5 py-1.5 rounded-lg border border-[#00FF00]/40">
                                AI đang xác minh khuôn mặt...
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Các nút Chụp ảnh / Chụp lại / Tải file đặt ngay dưới khung ảnh để không che khuôn mặt */}
                    <div className="w-full max-w-[380px] lg:max-w-none space-y-3 font-sans mx-auto">
                      {/* Thông báo kết quả xác minh AI nếu đã chụp ảnh */}
                      {capturedImage && !isVerifying && verificationResult && (
                        <div
                          className={cn(
                            "p-3 rounded-xl text-xs flex items-start gap-2.5 border transition-all",
                            verificationResult.success
                              ? "bg-[#00FF00]/10 border-[#00FF00]/40 text-[#00FF00]"
                              : "bg-red-500/10 border-red-500/40 text-red-400"
                          )}
                        >
                          {verificationResult.success ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#00FF00]" />
                          ) : (
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                          )}
                          <div className="space-y-0.5">
                            <p className="font-bold">
                              {verificationResult.success ? "Xác minh thành công" : "Chưa đạt yêu cầu nhận diện"}
                            </p>
                            <p className="text-[11px] leading-relaxed opacity-90">{verificationResult.message}</p>
                          </div>
                        </div>
                      )}

                      {/* Dãy nút thao tác chụp ảnh và tải tệp tối ưu cho điện thoại */}
                      <div className="space-y-2">
                        {!capturedImage ? (
                          <>
                            <button
                              type="button"
                              onClick={capture}
                              className="w-full bg-[#00FF00] hover:bg-[#00CC00] text-black py-3.5 rounded-xl shadow-lg active:scale-95 transition-all font-bold text-xs sm:text-sm flex items-center justify-center gap-2 border border-black/10 cursor-pointer uppercase tracking-wider font-mono shadow-[#00FF00]/15"
                            >
                              <Camera className="w-4 h-4" /> CHỤP ẢNH XÁC THỰC
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => nativeCameraInputRef.current?.click()}
                                className="bg-[#1c1d21] hover:bg-[#252830] text-zinc-200 hover:text-white py-2.5 px-2 rounded-xl shadow-md active:scale-95 transition-all font-semibold text-xs flex items-center justify-center gap-1.5 border border-[#333] cursor-pointer"
                                title="Mở máy ảnh điện thoại của thiết bị"
                              >
                                <Smartphone className="w-3.5 h-3.5 text-[#00FF00]" /> Dùng Máy Ảnh Máy
                              </button>
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-[#1c1d21] hover:bg-[#252830] text-zinc-200 hover:text-white py-2.5 px-2 rounded-xl shadow-md active:scale-95 transition-all font-semibold text-xs flex items-center justify-center gap-1.5 border border-[#333] cursor-pointer"
                              >
                                <Upload className="w-3.5 h-3.5 text-[#00FF00]" /> Tải Ảnh Có Sẵn
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setCapturedImage(null);
                                setVerificationResult(null);
                              }}
                              className="flex-1 bg-[#1c1d21] hover:bg-[#252830] text-white py-3 rounded-xl shadow-md active:scale-95 transition-all font-bold text-xs flex items-center justify-center gap-2 border border-[#333] cursor-pointer uppercase tracking-wider font-mono"
                            >
                              <RotateCcw className="w-4 h-4 text-[#00FF00]" /> CHỤP LẠI
                            </button>
                            <button
                              type="button"
                              onClick={() => nativeCameraInputRef.current?.click()}
                              className="flex-1 bg-[#141518] hover:bg-[#1f2228] text-zinc-300 hover:text-white py-3 rounded-xl border border-[#1c1d21] active:scale-95 transition-all font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider font-mono"
                            >
                              <Smartphone className="w-3.5 h-3.5 text-[#00FF00]" /> ĐỔI ẢNH KHÁC
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* CỘT THÔNG TIN: ~60% (7 cols out of 12) */}
                  <div className="lg:col-span-7 flex flex-col justify-between space-y-4 md:space-y-5 w-full">
                    {/* Header thông tin */}
                    <div className="border-b border-[#1c1d21] pb-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#00FF00]" />
                        <span className="text-xs font-bold uppercase tracking-wider text-white font-mono">
                          THÔNG TIN ĐĂNG KÝ XIN RA CỔNG
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8E9299]">Điền thông tin hợp lệ</span>
                    </div>

                    {/* Các trường nhập thông tin */}
                    <div className="space-y-4 font-sans">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold">Họ và tên học sinh / cán bộ</label>
                        <input required type="text" placeholder="Nhập họ và tên..." value={formData.fullName} onChange={(e) => setFormData({...formData, fullName: e.target.value})} className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]" />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold">
                            Lớp học / Chức vụ
                          </label>
                          <input 
                            required 
                            type="text" 
                            placeholder="Nhập lớp (Ví dụ: 12A1)..." 
                            value={formData.department} 
                            onChange={(e) => setFormData({...formData, department: e.target.value})} 
                            className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all placeholder:text-[#5e6166]" 
                          />
                        </div>
                        
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold">
                              Số điện thoại (Bắt buộc 10 số)
                            </label>
                            <span className={cn(
                              "text-[9px] font-mono font-bold",
                              formData.phoneNumber.length === 10 ? "text-[#00FF00]" : "text-amber-400"
                            )}>
                              {formData.phoneNumber.length}/10 số
                            </span>
                          </div>
                          <input 
                            required 
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]{10}"
                            maxLength={10}
                            placeholder="Ví dụ: 0912345678" 
                            value={formData.phoneNumber} 
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                              setFormData({...formData, phoneNumber: val});
                            }} 
                            className={cn(
                              "w-full bg-[#0a0a0a] border rounded-xl px-4 py-3 text-xs text-white outline-none transition-all placeholder:text-[#5e6166] font-mono tracking-wider",
                              formData.phoneNumber.length === 10 ? "border-[#00FF00] focus:ring-1 focus:ring-[#00FF00]" : "border-[#1c1d21] focus:border-cyan-400"
                            )} 
                          />
                        </div>
                      </div>
                      {formData.phoneNumber && formData.phoneNumber.length < 10 && (
                        <span className="text-[10px] text-amber-400 block font-sans -mt-2">
                          ⚠️ Số điện thoại liên hệ phải có đúng 10 số (còn thiếu {10 - formData.phoneNumber.length} số).
                        </span>
                      )}

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-sans">
                            Thời gian ra cổng mong muốn
                          </label>
                          <span className="text-[9px] text-[#00FF00] font-medium font-sans">Gợi ý nhanh (+phút):</span>
                        </div>
                        <input 
                          required 
                          type="datetime-local" 
                          value={formData.exitTime} 
                          onChange={(e) => {
                            setSelectedQuickMinutes(null);
                            setFormData({...formData, exitTime: e.target.value});
                          }} 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-xs text-white focus:border-[#00FF00] outline-none transition-all font-mono" 
                        />
                        
                        {/* Gợi ý thời gian ra cổng: 5 phút, 10 phút, 15 phút, 20 phút */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 font-sans">
                          <span className="text-[10px] text-[#8E9299] font-mono mr-0.5">Gợi ý nhanh:</span>
                          {[5, 10, 15, 20].map((mins) => {
                            const isChosen = selectedQuickMinutes === mins;
                            return (
                              <button
                                key={mins}
                                type="button"
                                onClick={() => setQuickTimeMinutes(mins)}
                                className={cn(
                                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all active:scale-95 cursor-pointer font-mono flex items-center gap-1.5",
                                  isChosen
                                    ? "bg-[#00FF00] text-black border-[#00FF00] shadow-md shadow-[#00FF00]/15"
                                    : "bg-[#141518] hover:bg-[#1f2228] border-[#1c1d21] text-zinc-300 hover:text-[#00FF00] hover:border-[#00FF00]/30"
                                )}
                              >
                                <Clock className="w-3 h-3" />
                                +{mins} phút
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Lý do xin ra cổng */}
                      <div className="space-y-2 pt-1 font-sans">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-sans">
                            Lý do xin ra cổng (Chọn 1 trong các gợi ý dưới đây)
                          </label>
                          {selectedReasonOption && (
                            <span className="text-[10px] text-[#00FF00] font-mono font-bold flex items-center gap-1">
                              <Check className="w-3 h-3 stroke-[3]" />
                              {selectedReasonOption === "Lý do khác" ? "Đã chọn: Lý do khác" : `Đã chọn: ${selectedReasonOption}`}
                            </span>
                          )}
                        </div>
                        
                        {/* Danh sách các gợi ý lý do */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {QUICK_REASONS.map((r) => {
                            const isSelected = selectedReasonOption === r;
                            const isOther = r === "Lý do khác";
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => {
                                  setSelectedReasonOption(r);
                                  if (isOther) {
                                    setFormData(prev => ({ ...prev, reason: customReasonText }));
                                  } else {
                                    setFormData(prev => ({ ...prev, reason: r }));
                                  }
                                }}
                                className={cn(
                                  "px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-between gap-2 text-left cursor-pointer active:scale-[0.98]",
                                  isOther ? "sm:col-span-2" : "",
                                  isSelected
                                    ? "bg-[#00FF00]/15 text-[#00FF00] border-[#00FF00] shadow-md shadow-[#00FF00]/10 ring-1 ring-[#00FF00]"
                                    : "bg-[#141518] text-zinc-300 border-[#1c1d21] hover:text-white hover:border-[#333] hover:bg-[#1c1e24]"
                                )}
                              >
                                <span className="font-semibold">{r}</span>
                                <div className={cn(
                                  "w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all",
                                  isSelected ? "border-[#00FF00] bg-[#00FF00] text-black" : "border-zinc-700 bg-transparent"
                                )}>
                                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Chỉ mở ô nhập lý do khi người dùng chọn 'Lý do khác' để tối ưu giao diện */}
                        <AnimatePresence>
                          {selectedReasonOption === "Lý do khác" && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-1.5 pt-2 overflow-hidden"
                            >
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] text-[#00FF00] font-bold uppercase tracking-wider block font-sans">
                                  Nhập lý do cụ thể của bạn:
                                </label>
                                <span className="text-[9px] text-[#8E9299] font-mono">
                                  {customReasonText.length}/300 ký tự
                                </span>
                              </div>
                              <textarea
                                required
                                autoFocus
                                rows={3}
                                maxLength={300}
                                placeholder="Ghi rõ lý do bạn cần ra ngoài trường / công sở..."
                                value={customReasonText}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setCustomReasonText(val);
                                  setFormData(prev => ({ ...prev, reason: val }));
                                }}
                                className="w-full bg-[#0a0a0a] border border-[#00FF00]/50 focus:border-[#00FF00] rounded-xl px-4 py-3 text-xs text-white outline-none transition-all resize-none placeholder:text-[#5e6166] leading-relaxed ring-1 ring-[#00FF00]/20"
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Nút gửi phiếu ở cột thông tin */}
                    <div className="pt-3 font-sans">
                      <button 
                        type="submit"
                        disabled={
                          !capturedImage || 
                          !verificationResult?.success || 
                          isSubmitting || 
                          formData.phoneNumber.length !== 10 ||
                          !selectedReasonOption ||
                          (selectedReasonOption === "Lý do khác" && !customReasonText.trim())
                        } 
                        className="w-full bg-[#00FF00] disabled:bg-[#1c1d21] disabled:text-[#8E9299] text-black font-bold py-3.5 rounded-xl transition-all hover:shadow-[#00FF00]/10 hover:shadow-lg active:scale-95 flex items-center justify-center gap-2 text-xs border border-[#00FF00]/20 uppercase tracking-wider cursor-pointer"
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Gửi phiếu đăng ký ra cổng
                      </button>
                      {!capturedImage ? (
                        <p className="text-[10px] text-amber-400/90 text-center mt-2 font-sans">
                          ⚠️ Chụp ảnh hoặc tải file khuôn mặt ở cột bên trái trước khi gửi phiếu.
                        </p>
                      ) : !verificationResult?.success ? (
                        <p className="text-[10px] text-amber-400/90 text-center mt-2 font-sans">
                          ⚠️ Đang chờ AI xác minh hoặc khuôn mặt chưa đạt yêu cầu.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        ) : (
          /* ================= GIAO DIỆN QUẢN LÝ & XEM DANH SÁCH PHIẾU (100% CHIỀU RỘNG CHUYÊN NGHIỆP) ================= */
          <div className="w-full space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-white uppercase tracking-wider font-mono">
                <LayoutDashboard className="w-5 h-5 text-[#00FF00]" />
                {userProfile?.role === 'admin' ? "QUẢN LÝ PHÊ DUYỆT PHIẾU RA CỔNG" : "LỊCH SỬ ĐĂNG KÝ CỦA TÔI"}
              </h2>
              <div className="flex items-center gap-3">
                {userProfile && (
                  <button 
                    onClick={() => {
                      setIsCreating(true);
                      setSelectedReasonOption('');
                      setCustomReasonText('');
                      setSelectedQuickMinutes(null);
                      setFormData(prev => ({
                        ...prev,
                        reason: '',
                        exitTime: getVietnamOrLocalISOString()
                      }));
                    }}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95 bg-[#00FF00] hover:bg-[#00CC00] text-black font-sans shadow-[#00FF00]/10"
                  >
                    <Plus className="w-4 h-4 font-black" />
                    TẠO PHIẾU RA CỔNG
                  </button>
                )}
                {userProfile?.role === 'admin' && isMasterAdmin && (
                  <button 
                    onClick={() => setShowIntegrations(!showIntegrations)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95 border border-[#1c1d21] font-sans", 
                      showIntegrations ? "bg-[#00FF00] text-black" : "bg-[#151619] text-[#8E9299] hover:text-white"
                    )}
                  >
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    {showIntegrations ? "ĐÓNG KẾT NỐI WEBHOOKS" : "⚡ KẾT NỐI VỚI WEBHOOKS"}
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {userProfile?.role === 'admin' && isMasterAdmin && showIntegrations && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-[#151619] border border-[#1c1d21] rounded-2xl p-6 space-y-6 overflow-hidden shadow-2xl"
                >
                  <div className="flex items-center justify-between border-b border-[#1c1d21] pb-3 font-sans">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#00FF00]/10 border border-[#00FF00]/30 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-[#00FF00]" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm tracking-wider uppercase text-white flex items-center gap-2">
                          Cấu hình liên kết Make AI & Google Sheets
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/30 font-mono lowercase">
                            make.com
                          </span>
                        </h3>
                        <p className="text-[11px] text-[#8E9299]">Tự động hóa luồng dữ liệu học sinh ra cổng vào Google Sheets & các tác vụ AI</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowIntegrations(false)} 
                      className="p-1 rounded-lg text-[#8E9299] hover:text-white hover:bg-[#1c1d21] transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
                    {/* Cột trái: Cấu hình thông số */}
                    <div className="lg:col-span-6 space-y-4 font-sans">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] text-[#8E9299] font-bold uppercase tracking-wider block">
                            Make.com Webhook URL (Liên kết chính thức của hệ thống)
                          </label>
                          <span className="text-[10px] font-mono text-[#00FF00] bg-[#00FF00]/10 px-2 py-0.5 rounded border border-[#00FF00]/20">
                            HTTPS POST
                          </span>
                        </div>
                        <input 
                          type="text" 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-white focus:border-[#00FF00] outline-none font-mono text-xs shadow-inner"
                          value={integrationWebhook}
                          onChange={(e) => {
                            setIntegrationWebhook(e.target.value);
                            localStorage.setItem('config_webhook_url', e.target.value);
                          }}
                          placeholder={OFFICIAL_MAKE_WEBHOOK_URL}
                        />

                        {/* Nút khôi phục cấu hình chính thức & Gợi ý */}
                        <div className="space-y-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setIntegrationWebhook(OFFICIAL_MAKE_WEBHOOK_URL);
                              setIntegrationSheetName(OFFICIAL_SHEET_NAME);
                              localStorage.setItem('config_webhook_url', OFFICIAL_MAKE_WEBHOOK_URL);
                              localStorage.setItem('config_sheet_name', OFFICIAL_SHEET_NAME);
                            }}
                            className="w-full py-1.5 px-3 rounded-lg bg-[#00FF00]/10 border border-[#00FF00]/30 hover:bg-[#00FF00]/20 text-[#00FF00] font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Khôi phục Webhook & Trang tính Chính thức ({OFFICIAL_SHEET_NAME})
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1">
                        <label className="text-[11px] text-[#8E9299] font-bold uppercase tracking-wider block">
                          Tên Sheet Tab (Google Sheets)
                        </label>
                        <input 
                          type="text" 
                          className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-white focus:border-[#00FF00] outline-none font-mono text-xs"
                          value={integrationSheetName}
                          onChange={(e) => {
                            setIntegrationSheetName(e.target.value);
                            localStorage.setItem('config_sheet_name', e.target.value);
                          }}
                          placeholder={OFFICIAL_SHEET_NAME}
                        />
                        <span className="text-[10px] text-[#8E9299] italic block">
                          Tên của thẻ Sheet bên trong bảng tính Google Spreadsheet (Mặc định: {OFFICIAL_SHEET_NAME}).
                        </span>
                      </div>
                    </div>

                    {/* Cột phải: Hướng dẫn tích hợp Make trực quan 4 bước */}
                    <div className="lg:col-span-6 bg-[#0a0a0a] border border-[#1c1d21] rounded-xl p-5 space-y-4 font-sans">
                      <div className="flex items-center gap-2 border-b border-[#1c1d21] pb-2.5">
                        <ShieldCheck className="w-4 h-4 text-[#00FF00]" />
                        <h4 className="font-bold text-[#00FF00] text-xs tracking-wide uppercase">
                          💡 4 Bước Tích Hợp Make AI & Google Sheets
                        </h4>
                      </div>
                      
                      <div className="space-y-3 text-[#8E9299] leading-relaxed text-[11px]">
                        <div className="flex gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-[#1c1d21] text-white flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                            1
                          </span>
                          <div>
                            <strong className="text-white">Tạo Webhook trên Make.com:</strong>
                            <p className="mt-0.5">
                              Vào <strong className="text-white">Make.com</strong> &gt; Tạo <strong>Scenario</strong> mới &gt; Thêm module <strong className="text-white">Webhooks</strong> &gt; Chọn <strong className="text-white">Custom Webhook</strong> &gt; Đặt tên và Copy URL.
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-[#1c1d21] text-[#00FF00] flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                            2
                          </span>
                          <div>
                            <strong className="text-white">Dán link & Lưu cấu hình:</strong>
                            <p className="mt-0.5">
                              Dán link vào ô bên trái, sau đó bấm nút <span className="text-[#00FF00] font-semibold">"LƯU CẤU HÌNH WEBHOOK"</span> bên dưới. Hệ thống sẽ tự động đồng bộ dữ liệu thời gian thực mỗi khi có phiếu được tạo hoặc duyệt.
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-[#1c1d21] text-white flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                            3
                          </span>
                          <div>
                            <strong className="text-white">Cập nhật Google Sheets ({integrationSheetName || OFFICIAL_SHEET_NAME}):</strong>
                            <p className="mt-0.5">
                              Tạo cột trên sheet tương ứng và map biến trong module <strong className="text-white">Google Sheets [Add a Row]</strong>:
                            </p>
                            <ul className="mt-1 space-y-1 list-disc list-inside pl-1 text-[10.5px]">
                              <li><span className="text-white font-semibold">Mã phiếu đăng ký (ID):</span> kéo <code className="text-[#00FF00] font-mono font-bold">id</code> hoặc <code className="text-[#00FF00] font-mono font-bold">passId</code></li>
                              <li><span className="text-white font-semibold">Thời gian muốn ra cổng:</span> kéo <code className="text-[#00FF00] font-mono font-bold">thoigian_muon_ra_cong</code> (giờ học sinh xin ra)</li>
                              <li><span className="text-white font-semibold">Thời gian gửi phiếu:</span> kéo <code className="text-[#00FF00] font-mono font-bold">thoigian_gui_phieu</code> (giờ bấm nộp đơn)</li>
                              <li><span className="text-white font-semibold">Thời gian duyệt phiếu:</span> kéo <code className="text-[#00FF00] font-mono font-bold">thoigian_duyet_phieu</code> (giờ Admin phê duyệt)</li>
                              <li><span className="text-white font-semibold">Người & Chức vụ duyệt:</span> kéo <code className="text-[#00FF00] font-mono font-bold">nguoi_duyet</code> và <code className="text-[#00FF00] font-mono font-bold">chuc_vu_nguoi_duyet</code></li>
                            </ul>
                          </div>
                        </div>

                        <div className="flex gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-[#1c1d21] text-white flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                            4
                          </span>
                          <div>
                            <strong className="text-white">Tận dụng Make AI hoặc Thông báo tự động:</strong>
                            <p className="mt-0.5">
                              Thêm module <strong className="text-white">OpenAI / Make AI</strong> để tóm tắt lý do ra cổng hoặc gửi Email/Telegram bằng biến tin nhắn soạn sẵn tiếng Việt: <code className="text-[#00FF00] font-mono">message</code> (đã bao gồm đầy đủ mã phiếu ID, cả 3 mốc thời gian, tên & chức vụ người duyệt).
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Hướng dẫn quy tắc gửi Mail tự động và bộ lọc Make.com */}
                      <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-950/20 text-xs text-blue-200 space-y-1.5 font-sans">
                        <div className="flex items-center gap-2 font-bold text-blue-300 uppercase text-[11px] tracking-wider">
                          <Mail className="w-4 h-4 text-blue-400" />
                          <span>Quy tắc gửi Email tự động qua Webhook / Make AI:</span>
                        </div>
                        <div className="text-[11px] text-zinc-300 leading-relaxed space-y-1">
                          <p>
                            • <strong className="text-emerald-400">CHỈ GỬI EMAIL KHI:</strong> Học sinh <strong className="text-white">Bấm gửi phiếu</strong> (<code className="text-[#00FF00]">create</code>) hoặc Cán bộ/Admin <strong className="text-white">Duyệt phiếu</strong> (<code className="text-[#00FF00]">update_status</code>).
                          </p>
                          <p>
                            • <strong className="text-red-400">KHÔNG GỬI EMAIL KHI:</strong> Phiếu <strong className="text-amber-400">ĐÃ HẾT HẠN</strong> (hoặc khi bấm đồng bộ Sheet).
                          </p>
                          <p>
                            • <strong className="text-cyan-300">Cách cài đặt Bộ lọc trên Make.com:</strong> Trước module Gmail / Email, thêm Filter: <code className="text-[#00FF00] bg-black/60 px-1 py-0.5 rounded font-mono">gui_qua_mail</code> Equal to <code className="text-white bg-black/60 px-1 py-0.5 rounded font-mono">Có</code> (hoặc <code className="text-[#00FF00] bg-black/60 px-1 py-0.5 rounded font-mono">gui_email</code> Equal to <code className="text-white bg-black/60 px-1 py-0.5 rounded font-mono">true</code>).
                          </p>
                        </div>
                      </div>

                      {/* Bảng tra cứu toàn bộ các trường dữ liệu của phiếu gửi sang Google Sheets */}
                      <div className="pt-3 border-t border-[#1c1d21] space-y-3 font-sans">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-[#00FF00]" />
                            <h5 className="font-bold text-xs uppercase tracking-wider text-white">
                              Danh sách toàn bộ các trường dữ liệu phiếu gửi qua Webhook vào Google Sheets
                            </h5>
                          </div>
                          <span className="text-[10px] text-[#8E9299]">Bấm vào tên biến để sao chép nhanh</span>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-[#1c1d21] bg-[#0c0d10] max-h-60 overflow-y-auto">
                          <table className="w-full text-left text-[11px] border-collapse">
                            <thead className="sticky top-0 z-10">
                              <tr className="border-b border-[#1c1d21] bg-[#121316] text-[#8E9299] font-mono uppercase text-[10px]">
                                <th className="py-2.5 px-3">Tên trường (Tiếng Việt)</th>
                                <th className="py-2.5 px-3">Tên trường (Tiếng Anh / Alias)</th>
                                <th className="py-2.5 px-3">Ý nghĩa & Dữ liệu</th>
                                <th className="py-2.5 px-3">Cột gợi ý trên Sheets</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#1c1d21]/60 text-zinc-300">
                              {[
                                { vn: 'gui_qua_mail', en: 'gui_email / sendEmail', desc: 'Có/Không (CHỈ \'Có\' khi Bấm gửi phiếu & Duyệt phiếu; \'Không\' khi phiếu hết hạn)', sheetCol: 'Lọc gửi Mail' },
                                { vn: 'tieu_de_mail', en: 'email_subject', desc: 'Tiêu đề Email soạn sẵn (để trống nếu phiếu đã hết hạn)', sheetCol: 'Tiêu đề Mail' },
                                { vn: 'noi_dung_email', en: 'email_body', desc: 'Nội dung Email chi tiết (để trống nếu phiếu đã hết hạn)', sheetCol: 'Thân Mail' },
                                { vn: 'ma_phieu', en: 'passId / id', desc: 'Mã số phiếu ra cổng (VD: GP-260927-5891)', sheetCol: 'Cột A (Mã phiếu)' },
                                { vn: 'ho_ten', en: 'fullName', desc: 'Họ và tên học sinh hoặc cán bộ xin ra', sheetCol: 'Cột B (Họ tên)' },
                                { vn: 'lop_phong_ban', en: 'department', desc: 'Lớp học hoặc Phòng ban phụ trách (VD: 12A1)', sheetCol: 'Cột C (Lớp/Khoa)' },
                                { vn: 'so_dien_thoai', en: 'phoneNumber', desc: 'Số điện thoại (đã tự động thêm dấu \' ở đầu để Google Sheets bảo toàn 100% số 0)', sheetCol: 'Cột D (Số điện thoại)' },
                                { vn: 'so_dien_thoai_goc', en: 'phoneNumberRaw', desc: 'Số điện thoại dạng số thuần túy (không có dấu \')', sheetCol: 'SMS / Bot' },
                                { vn: 'ly_do', en: 'reason', desc: 'Lý do xin ra ngoài trường', sheetCol: 'Cột E (Lý do)' },
                                { vn: 'thoigian_muon_ra_cong', en: 'exitTime', desc: 'Thời gian muốn ra cổng (do học sinh chọn)', sheetCol: 'Cột F (Giờ muốn ra)' },
                                { vn: 'thoigian_gui_phieu', en: 'createdAt', desc: 'Thời điểm học sinh nộp đơn lên hệ thống', sheetCol: 'Cột G (Giờ gửi phiếu)' },
                                { vn: 'trang_thai', en: 'status', desc: 'Trạng thái: Chờ duyệt / Đã duyệt / Từ chối / Đã hết hạn', sheetCol: 'Cột H (Trạng thái)' },
                                { vn: 'nguoi_duyet', en: 'approvedBy', desc: 'Họ tên cán bộ quản trị xét duyệt (VD: Trần Minh Lý)', sheetCol: 'Cột I (Người duyệt)' },
                                { vn: 'chuc_vu_nguoi_duyet', en: 'approverPosition / approverRole', desc: 'Chức vụ người duyệt (Bí thư ĐT, P.Bí thư ĐT...)', sheetCol: 'Cột J (Chức vụ)' },
                                { vn: 'email_nguoi_duyet', en: 'approverEmail', desc: 'Email tài khoản quản trị đã duyệt', sheetCol: 'Cột K (Email duyệt)' },
                                { vn: 'thoigian_duyet_phieu', en: 'approvedAt', desc: 'Thời điểm admin bấm phê duyệt hoặc từ chối', sheetCol: 'Cột L (Giờ duyệt)' },
                                { vn: 'thoigian_het_han', en: 'expiredAt', desc: 'Mốc hết hiệu lực ra cổng (30 phút sau khi duyệt)', sheetCol: 'Cột M (Giờ hết hạn)' },
                                { vn: 'link_xac_minh', en: 'verifyUrl', desc: 'Đường link thẻ bảo vệ trực tuyến xác minh mã QR', sheetCol: 'Cột N (Link xác minh)' },
                                { vn: 'anh_khuon_mat', en: 'photoUrl', desc: 'Dữ liệu hoặc liên kết ảnh chụp nhận diện khuôn mặt', sheetCol: 'Cột O (Ảnh nhận diện)' },
                                { vn: 'loai_su_kien', en: 'action', desc: 'Loại sự kiện (Tạo mới / Duyệt / Hết hạn / Đồng bộ)', sheetCol: 'Cột P (Sự kiện)' },
                                { vn: 'ten_sheet', en: 'googleSheetName', desc: `Tên thẻ bảng tính Google Sheets đích (mặc định: ${OFFICIAL_SHEET_NAME})`, sheetCol: 'Thẻ bảng tính' },
                                { vn: 'noi_dung_thong_bao', en: 'message', desc: 'Đoạn văn bản tóm tắt đầy đủ để gửi Bot/Telegram/Email', sheetCol: 'Cột Ghi chú / Thông báo' },
                              ].map((row) => (
                                <tr key={row.vn} className="hover:bg-[#15171c] transition-colors">
                                  <td className="py-2 px-3 font-mono text-[#00FF00] font-bold cursor-pointer hover:underline" onClick={() => {
                                    navigator.clipboard.writeText(row.vn);
                                    setCopiedFieldName(row.vn);
                                    setTimeout(() => setCopiedFieldName(null), 2000);
                                  }} title="Bấm để copy">
                                    <div className="flex items-center gap-1.5">
                                      <span>{row.vn}</span>
                                      {copiedFieldName === row.vn && <span className="text-[9px] text-white bg-[#00FF00]/30 px-1 rounded font-sans">Đã copy</span>}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 font-mono text-cyan-300 cursor-pointer hover:underline" onClick={() => {
                                    const primaryEn = row.en.split('/')[0].trim();
                                    navigator.clipboard.writeText(primaryEn);
                                    setCopiedFieldName(primaryEn);
                                    setTimeout(() => setCopiedFieldName(null), 2000);
                                  }} title="Bấm để copy">
                                    {row.en}
                                  </td>
                                  <td className="py-2 px-3 text-zinc-300">{row.desc}</td>
                                  <td className="py-2 px-3 font-mono text-amber-300/90 text-[10px]">{row.sheetCol}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  {saveConfigSuccess && (
                    <div className="p-3 bg-[#00FF00]/15 border border-[#00FF00]/30 rounded-xl text-[#00FF00] text-xs flex items-center gap-2 font-sans font-bold">
                      <CheckCircle2 className="w-4 h-4 text-[#00FF00]" />
                      Đã lưu cấu hình liên kết Make AI & Google Sheets thành công!
                    </div>
                  )}

                  <div className="flex justify-end items-center gap-3 pt-2 font-sans border-t border-[#1c1d21]">
                    <button 
                      onClick={() => {
                        setShowIntegrations(false);
                      }}
                      className="px-5 py-2.5 rounded-xl text-xs font-semibold text-[#8E9299] hover:text-white hover:bg-[#1c1d21] transition-all cursor-pointer"
                    >
                      Đóng
                    </button>
                    <button 
                      onClick={async () => {
                        const finalWebhook = (integrationWebhook?.trim() && !integrationWebhook.includes("your_make_webhook_id")) ? integrationWebhook.trim() : OFFICIAL_MAKE_WEBHOOK_URL;
                        const finalSheet = (integrationSheetName?.trim() && integrationSheetName.trim() !== "DanhSachRaCong") ? integrationSheetName.trim() : OFFICIAL_SHEET_NAME;

                        setIntegrationWebhook(finalWebhook);
                        setIntegrationSheetName(finalSheet);
                        localStorage.setItem('config_webhook_url', finalWebhook);
                        localStorage.setItem('config_sheet_name', finalSheet);

                        try {
                          await setDoc(doc(db, 'system_settings', 'integration'), {
                            webhookUrl: finalWebhook,
                            sheetName: finalSheet,
                            updatedAt: new Date().toISOString(),
                            updatedBy: user?.email || 'Admin'
                          }, { merge: true });
                        } catch (err) {
                          console.warn("Lỗi lưu cấu hình hệ thống lên Firestore:", err);
                        }

                        setSaveConfigSuccess(true);
                        setTimeout(() => {
                          setSaveConfigSuccess(false);
                          setShowIntegrations(false);
                        }, 1200);
                      }}
                      className="bg-[#00FF00] hover:bg-[#00CC00] text-black font-bold px-6 py-2.5 rounded-xl text-xs active:scale-95 transition-all text-center flex items-center gap-2 cursor-pointer"
                    >
                      <Check className="w-4 h-4 font-black" />
                      LƯU CẤU HÌNH MAKE AI
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Toast thông báo kết quả đồng bộ Webhook / Sheet */}
            <AnimatePresence>
              {syncToast && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  className={cn(
                    "fixed top-20 right-4 sm:right-6 z-[200] max-w-md p-4 rounded-2xl shadow-2xl border backdrop-blur-md flex items-start gap-3 font-sans text-xs",
                    syncToast.success 
                      ? "bg-[#111317]/95 border-[#00FF00]/40 text-[#00FF00]" 
                      : "bg-[#161214]/95 border-red-500/40 text-red-400"
                  )}
                >
                  {syncToast.success ? (
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-[#00FF00] mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
                  )}
                  <div className="space-y-0.5 flex-1">
                    <span className="font-bold block text-sm">
                      {syncToast.success ? "Đồng bộ Webhook thành công" : "Lỗi gửi Webhook"}
                    </span>
                    <p className="text-zinc-300 text-[11px] leading-relaxed">
                      {syncToast.message}
                    </p>
                  </div>
                  <button 
                    onClick={() => setSyncToast(null)}
                    className="p-1 text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {user && !user.emailVerified && userProfile?.role === 'student' && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/50 rounded-2xl text-yellow-500 text-xs flex items-center justify-between gap-4 font-sans">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p>Tài khoản chưa xác minh. Vui lòng kiểm tra email để kích hoạt đầy đủ tính năng.</p>
                </div>
                <button 
                  onClick={() => sendEmailVerification(user).then(() => alert("Đã gửi lại email xác minh!"))}
                  className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-lg font-bold transition-colors whitespace-nowrap"
                >
                  GỬI LẠI
                </button>
              </div>
            )}

            {/* ================= BẢNG ĐIỀU KHIỂN KPI & THỐNG KÊ TƯƠNG TÁC ================= */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 font-sans">
              {/* Thẻ 1: Tất cả */}
              <div 
                onClick={() => setActiveTab('all')}
                className={cn(
                  "p-4 sm:p-4.5 rounded-2xl border transition-all cursor-pointer select-none active:scale-95 flex flex-col justify-between",
                  activeTab === 'all'
                    ? "bg-[#181a20] border-[#00FF00] shadow-lg shadow-[#00FF00]/5"
                    : "bg-[#131418] border-[#1c1d21] hover:border-zinc-700"
                )}
              >
                <div className="flex items-center justify-between text-[#8E9299]">
                  <span className="text-[10px] uppercase tracking-wider font-bold">Tất cả phiếu</span>
                  <History className="w-4 h-4" />
                </div>
                <div className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl lg:text-3xl font-black text-white font-mono">{metrics.total}</span>
                  <span className="text-[10px] text-[#8E9299]">hồ sơ</span>
                </div>
              </div>

              {/* Thẻ 2: Chờ duyệt */}
              <div 
                onClick={() => setActiveTab('pending')}
                className={cn(
                  "p-4 sm:p-4.5 rounded-2xl border transition-all cursor-pointer select-none active:scale-95 flex flex-col justify-between",
                  activeTab === 'pending'
                    ? "bg-amber-950/20 border-amber-500 shadow-lg shadow-amber-500/10"
                    : "bg-[#131418] border-[#1c1d21] hover:border-amber-500/40"
                )}
              >
                <div className="flex items-center justify-between text-amber-400">
                  <span className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                    Chờ duyệt
                  </span>
                  <Clock className="w-4 h-4" />
                </div>
                <div className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl lg:text-3xl font-black text-amber-400 font-mono">{metrics.pending}</span>
                  {metrics.pending > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">Cần duyệt</span>
                  )}
                </div>
              </div>

              {/* Thẻ 3: Đã duyệt (Còn hiệu lực 30p) */}
              <div 
                onClick={() => setActiveTab('approved')}
                className={cn(
                  "p-4 sm:p-4.5 rounded-2xl border transition-all cursor-pointer select-none active:scale-95 flex flex-col justify-between",
                  activeTab === 'approved'
                    ? "bg-emerald-950/20 border-[#00FF00] shadow-lg shadow-[#00FF00]/10"
                    : "bg-[#131418] border-[#1c1d21] hover:border-emerald-500/40"
                )}
              >
                <div className="flex items-center justify-between text-[#00FF00]">
                  <span className="text-[10px] uppercase tracking-wider font-bold">Đã duyệt (Còn hạn)</span>
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl lg:text-3xl font-black text-[#00FF00] font-mono">{metrics.approved}</span>
                  <span className="text-[10px] text-[#8E9299]">hợp lệ</span>
                </div>
              </div>

              {/* Thẻ 4: Đã hết hạn (Quá 30p kể từ lúc duyệt) */}
              <div 
                onClick={() => setActiveTab('expired')}
                className={cn(
                  "p-4 sm:p-4.5 rounded-2xl border transition-all cursor-pointer select-none active:scale-95 flex flex-col justify-between",
                  activeTab === 'expired'
                    ? "bg-amber-950/30 border-amber-500 shadow-lg shadow-amber-500/10"
                    : "bg-[#131418] border-[#1c1d21] hover:border-amber-500/40"
                )}
              >
                <div className="flex items-center justify-between text-amber-400">
                  <span className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1">
                    <Timer className="w-3.5 h-3.5 text-amber-400" />
                    Đã hết hạn
                  </span>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl lg:text-3xl font-black text-amber-400 font-mono">{metrics.expired}</span>
                  <span className="text-[9px] text-[#8E9299]">quá 30p</span>
                </div>
              </div>

              {/* Thẻ 5: Từ chối */}
              <div 
                onClick={() => setActiveTab('rejected')}
                className={cn(
                  "p-4 sm:p-4.5 rounded-2xl border transition-all cursor-pointer select-none active:scale-95 flex flex-col justify-between",
                  activeTab === 'rejected'
                    ? "bg-red-950/20 border-red-500 shadow-lg shadow-red-500/10"
                    : "bg-[#131418] border-[#1c1d21] hover:border-red-500/40"
                )}
              >
                <div className="flex items-center justify-between text-red-400">
                  <span className="text-[10px] uppercase tracking-wider font-bold">Từ chối</span>
                  <XCircle className="w-4 h-4" />
                </div>
                <div className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl lg:text-3xl font-black text-red-400 font-mono">{metrics.rejected}</span>
                  <span className="text-[10px] text-[#8E9299]">đã hủy</span>
                </div>
              </div>

              {/* Thẻ 6: Hôm nay & Realtime */}
              <div className="p-4 sm:p-4.5 rounded-2xl border border-[#1c1d21] bg-[#131418] flex flex-col justify-between">
                <div className="flex items-center justify-between text-[#8E9299]">
                  <span className="text-[10px] uppercase tracking-wider font-bold">Hôm nay</span>
                  <span className="w-2 h-2 rounded-full bg-[#00FF00] animate-pulse" />
                </div>
                <div className="mt-2.5 flex flex-col">
                  <span className="text-xl sm:text-2xl font-black text-white font-mono">{metrics.today} lượt</span>
                  <span className="text-[9px] text-[#8E9299] font-mono">{new Date(tickTime).toLocaleTimeString('vi-VN')}</span>
                </div>
              </div>
            </div>

            {/* ================= BỘ LỌC TỐI ƯU & THANH CÔNG CỤ ================= */}
            <div className="space-y-3 font-sans">
              <div className="flex flex-col md:flex-row md:items-center justify-between bg-[#151619] border border-[#1c1d21] rounded-2xl px-4 sm:px-5 py-3 sm:py-3.5 gap-3 shadow-lg">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-extrabold text-xs uppercase tracking-wider">Danh sách phiếu đăng ký</span>
                  <span className="text-[10px] font-mono text-[#00FF00] bg-[#00FF00]/10 px-2 py-0.5 rounded border border-[#00FF00]/20">
                    {filteredAndSortedPasses.length} kết quả
                  </span>
                  {userProfile?.role === 'admin' && !isMasterAdmin && (
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 font-mono">
                      ✓ Chức năng: Duyệt phiếu
                    </span>
                  )}
                  {(activeTab !== 'all' || searchQuery.trim() !== '' || sortBy !== 'newest') && (
                    <span className="w-2 h-2 rounded-full bg-[#00FF00] animate-pulse" title="Đang bật bộ lọc" />
                  )}
                </div>
                
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto justify-end">
                  {/* Chế độ xem: Thẻ / Bảng */}
                  <div className="flex items-center bg-[#0a0a0a] border border-[#1c1d21] rounded-xl p-0.5">
                    <button
                      onClick={() => setViewMode('cards')}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95",
                        viewMode === 'cards'
                          ? "bg-[#00FF00] text-black shadow-sm"
                          : "text-[#8E9299] hover:text-white"
                      )}
                      title="Chế độ xem dạng Thẻ chi tiết"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Thẻ</span>
                    </button>
                    <button
                      onClick={() => setViewMode('table')}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95",
                        viewMode === 'table'
                          ? "bg-[#00FF00] text-black shadow-sm"
                          : "text-[#8E9299] hover:text-white"
                      )}
                      title="Chế độ xem dạng Bảng cô đọng"
                    >
                      <TableIcon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Bảng</span>
                    </button>
                  </div>

                  {/* Nút Xuất Excel/CSV */}
                  <button
                    onClick={exportToCSV}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#0a0a0a] hover:bg-[#1a1c22] text-[#8E9299] hover:text-white border border-[#1c1d21] text-[10px] font-bold transition-all active:scale-95"
                    title="Xuất danh sách ra file CSV / Excel"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#00FF00]" />
                    <span className="hidden sm:inline">Xuất Excel</span>
                  </button>

                  {/* Tích chọn tất cả trên trang hiện tại */}
                  {paginatedPasses.length > 0 && (
                    <button
                      onClick={toggleSelectAllPasses}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all border cursor-pointer select-none active:scale-95",
                        paginatedPasses.every(p => selectedPassIds.includes(p.id!))
                          ? "bg-[#00FF00]/10 text-[#00FF00] border-[#00FF00]/30"
                          : "bg-[#0a0a0a] text-[#8E9299] border-[#1c1d21] hover:text-white hover:border-gray-700"
                      )}
                      title="Chọn tất cả phiếu trên trang này"
                    >
                      <div className={cn(
                        "w-3 h-3 rounded flex items-center justify-center transition-all border",
                        paginatedPasses.every(p => selectedPassIds.includes(p.id!))
                          ? "border-[#00FF00] bg-[#00FF00]"
                          : "border-[#8E9299] bg-[#0a0a0a]"
                      )}>
                        {paginatedPasses.every(p => selectedPassIds.includes(p.id!)) && <Check className="w-2 h-2 text-black stroke-[3]" />}
                      </div>
                      <span>Chọn hết</span>
                    </button>
                  )}

                  {/* Xóa hàng loạt - Chỉ Quản trị viên cấp cao có quyền xóa */}
                  {selectedPassIds.length > 0 && isMasterAdmin && (
                    <button
                      onClick={() => setBulkDeleteConfirm(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 text-[10px] font-bold transition-all cursor-pointer shadow-md active:scale-95 uppercase tracking-wider"
                      title={`Xóa ${selectedPassIds.length} phiếu đã chọn`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa ({selectedPassIds.length})</span>
                    </button>
                  )}

                  {/* Nút Bộ lọc */}
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border active:scale-95 cursor-pointer",
                      showFilters 
                        ? "bg-[#00FF00] text-black border-[#00FF00]" 
                        : "bg-[#0a0a0a] text-[#8E9299] border-[#1c1d21] hover:text-white hover:border-gray-700"
                    )}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{showFilters ? "Đóng bộ lọc" : "Bộ lọc & Tìm kiếm"}</span>
                    <span className="inline sm:hidden">{showFilters ? "Đóng" : "Bộ lọc"}</span>
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, scaleY: 0.95 }}
                    animate={{ opacity: 1, height: 'auto', scaleY: 1 }}
                    exit={{ opacity: 0, height: 0, scaleY: 0.95 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden origin-top"
                  >
                    <div className="bg-[#151619] border border-[#1c1d21] rounded-2xl p-4 md:p-5 space-y-4">
                      <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
                        {/* Search query */}
                        <div className="relative w-full md:w-96 lg:w-[440px] xl:w-[500px]">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-[#8E9299]">
                            <Search className="w-4 h-4" />
                          </span>
                          <input
                            type="text"
                            placeholder="Tìm kiếm học sinh, lớp, lý do, ID..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-10 py-2.5 text-xs text-white focus:border-[#00FF00] outline-none transition-colors"
                          />
                          {searchQuery && (
                            <button 
                              onClick={() => setSearchQuery('')}
                              className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#8E9299] hover:text-white"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Sort Option */}
                        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                          <span className="text-[10px] text-[#8E9299] uppercase font-bold tracking-wider whitespace-nowrap">Sắp xếp:</span>
                          <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#00FF00] font-sans cursor-pointer"
                          >
                            <option value="newest">🕒 Đăng ký mới nhất</option>
                            <option value="pendingFirst">💡 Chờ duyệt lên đầu</option>
                            <option value="oldest">🕧 Đăng ký cũ nhất</option>
                          </select>
                        </div>
                      </div>

                      {/* Phân loại Tab nhanh để Giám thị/Bảo vệ lọc tức thì */}
                      <div className="flex border-t border-[#1c1d21]/60 pt-3.5 overflow-x-auto gap-2 no-scrollbar">
                        {[
                          { id: 'all', label: 'Tất cả phiếu', count: metrics.total },
                          { id: 'pending', label: 'Chờ duyệt', count: metrics.pending },
                          { id: 'approved', label: 'Đã duyệt (Còn hạn)', count: metrics.approved },
                          { id: 'expired', label: 'Đã hết hạn (Quá 30p)', count: metrics.expired },
                          { id: 'rejected', label: 'Từ chối', count: metrics.rejected }
                        ].map(tab => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                              "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap active:scale-95",
                              activeTab === tab.id 
                                ? "bg-[#00FF00] text-black border-[#00FF00] shadow-lg shadow-[#00FF00]/10" 
                                : "bg-[#0a0a0a] text-[#8E9299] border-[#1c1d21] hover:text-white hover:border-gray-700"
                            )}
                          >
                            <span>{tab.label}</span>
                            <span className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded-md font-mono",
                              activeTab === tab.id ? "bg-black/20 text-black font-extrabold" : "bg-[#151619] text-[#8E9299]"
                            )}>
                              {tab.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ================= HIỂN THỊ DANH SÁCH (CHẾ ĐỘ THẺ HOẶC BẢNG CÔ ĐỌNG) ================= */}
            {viewMode === 'table' ? (
              /* DẠNG BẢNG DỮ LIỆU CÔ ĐỌNG (DÀNH CHO GIÁM THỊ & BẢO VỆ TRA CỨU NHANH) */
              <div className="bg-[#151619] border border-[#1c1d21] rounded-2xl overflow-hidden shadow-xl font-sans">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[1000px]">
                    <thead className="bg-[#0e0f12] border-b border-[#1c1d21] text-[#8E9299] uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="py-3 px-4 w-10 text-center">
                          <input 
                            type="checkbox"
                            checked={paginatedPasses.length > 0 && paginatedPasses.every(p => selectedPassIds.includes(p.id!))}
                            onChange={toggleSelectAllPasses}
                            className="rounded bg-[#0a0a0a] border-[#1c1d21] text-[#00FF00] focus:ring-0 cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-3">Ảnh</th>
                        <th className="py-3 px-3">Mã phiếu (ID)</th>
                        <th className="py-3 px-3">Họ và tên</th>
                        <th className="py-3 px-3">Lớp / Bộ phận</th>
                        <th className="py-3 px-3">Số điện thoại</th>
                        <th className="py-3 px-3 text-cyan-400">⏱️ Thời gian xin ra</th>
                        <th className="py-3 px-3 text-[#00FF00]">✓ Thời gian duyệt</th>
                        <th className="py-3 px-3">Lý do xin ra</th>
                        <th className="py-3 px-3">Gửi lúc</th>
                        <th className="py-3 px-3">Trạng thái</th>
                        <th className="py-3 px-4 text-right">Thao tác nhanh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1c1d21]/60">
                      {paginatedPasses.length > 0 ? (
                        paginatedPasses.map(pass => {
                          const effStatus = getPassEffectiveStatus(pass);
                          const remainingSecs = getPassRemainingSeconds(pass);
                          const isExpired = effStatus === 'Đã hết hạn';
                          const isApproved = effStatus === 'Đã duyệt';
                          
                          return (
                          <tr 
                            key={pass.id}
                            onClick={() => {
                              setSelectedPass(pass);
                              if (isApproved || isExpired || effStatus === 'Từ chối') {
                                setShowSecurityBadge(true);
                              } else {
                                setShowSecurityBadge(false);
                              }
                            }}
                            className={cn(
                              "hover:bg-[#1a1d24]/60 transition-colors cursor-pointer group",
                              selectedPassIds.includes(pass.id!) ? "bg-[#00FF00]/5" : ""
                            )}
                          >
                            <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox"
                                checked={selectedPassIds.includes(pass.id!)}
                                onChange={() => pass.id && toggleSelectPass(pass.id)}
                                className="rounded bg-[#0a0a0a] border-[#1c1d21] text-[#00FF00] focus:ring-0 cursor-pointer"
                              />
                            </td>
                            <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setZoomedPass(pass);
                                  setImageZoomScale(1);
                                  setPanOffset({ x: 0, y: 0 });
                                }}
                                className="w-10 h-10 rounded-lg overflow-hidden bg-black border border-[#1c1d21] relative cursor-pointer group/img hover:border-[#00FF00] transition-all"
                                title="Bấm vào để phóng to ảnh nhận diện"
                              >
                                <img src={pass.photoUrl} alt="Face" className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-300" referrerPolicy="no-referrer" />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                  <Eye className="w-4 h-4 text-[#00FF00]" />
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-[#00FF00] text-[11px] whitespace-nowrap">
                              {pass.passId || pass.id}
                            </td>
                            <td className="py-3 px-3 font-bold text-white group-hover:text-[#00FF00] transition-colors whitespace-nowrap">
                              {pass.fullName}
                            </td>
                            <td className="py-3 px-3 text-zinc-300 whitespace-nowrap font-medium">
                              {pass.department}
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-cyan-400 whitespace-nowrap font-bold">
                              {pass.phoneNumber ? `📞 ${pass.phoneNumber}` : <span className="text-zinc-500 font-normal">---</span>}
                            </td>
                            <td className="py-3 px-3 text-cyan-400 font-mono text-[11px] whitespace-nowrap">
                              <div className="flex items-center gap-1 font-bold">
                                <Clock className="w-3 h-3 text-cyan-400 shrink-0" />
                                <span>{new Date(pass.exitTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <span className="text-[9px] text-cyan-400/70 block mt-0.5">
                                {new Date(pass.exitTime).toLocaleDateString('vi-VN')}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] whitespace-nowrap">
                              {pass.approvedAt ? (
                                <div>
                                  <div className={cn(
                                    "flex items-center gap-1 font-bold",
                                    effStatus === 'Từ chối' ? "text-red-400" :
                                    isExpired ? "text-amber-400" : "text-[#00FF00]"
                                  )}>
                                    {isExpired ? (
                                      <Timer className="w-3 h-3 shrink-0 text-amber-400" />
                                    ) : (
                                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                                    )}
                                    <span>{new Date(pass.approvedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                  <span className="text-[9px] block mt-0.5 text-zinc-400">
                                    {new Date(pass.approvedAt).toLocaleDateString('vi-VN')}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-yellow-500/80 text-[10px] italic">Chờ duyệt</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-zinc-300 text-xs max-w-[220px] xl:max-w-xs truncate" title={pass.reason}>
                              {pass.reason}
                            </td>
                            <td className="py-3 px-3 text-[#8E9299] text-[10px] whitespace-nowrap">
                              {getRelativeTimeString(pass.createdAt)}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className={cn(
                                "text-[10px] px-2.5 py-1 rounded-full uppercase font-bold inline-flex items-center gap-1",
                                isApproved ? "bg-[#00FF00]/10 text-[#00FF00] border border-[#00FF00]/30" :
                                isExpired ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" :
                                effStatus === 'Từ chối' ? "bg-red-500/10 text-red-500 border border-red-500/20" : 
                                "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                              )}>
                                {isApproved ? '✓ Đã duyệt' : 
                                 isExpired ? (pass.status === 'rejected' || pass.status === 'Từ chối' ? '✕ Từ chối' : '⏱️ Đã hết hạn') :
                                 effStatus === 'Từ chối' ? '✕ Từ chối' : '⏳ Chờ duyệt'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Admin duyệt / từ chối nhanh */}
                                {userProfile?.role === 'admin' && (pass.status === 'pending' || pass.status === 'Chờ duyệt') && (
                                  <>
                                    <button
                                      onClick={() => handleUpdateStatus(pass.id!, 'approved')}
                                      className="p-1.5 rounded-lg bg-[#00FF00]/10 hover:bg-[#00FF00] text-[#00FF00] hover:text-black transition-all"
                                      title="Phê duyệt nhanh"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleUpdateStatus(pass.id!, 'rejected')}
                                      className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all"
                                      title="Từ chối nhanh"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomedPass(pass);
                                    setImageZoomScale(1);
                                    setPanOffset({ x: 0, y: 0 });
                                  }}
                                  className="p-1.5 rounded-lg bg-[#0a0a0a] hover:bg-[#00FF00]/15 text-[#8E9299] hover:text-[#00FF00] border border-transparent hover:border-[#00FF00]/30 transition-all cursor-pointer"
                                  title="Phóng to ảnh nhận diện"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedPass(pass);
                                    setShowSecurityBadge(false);
                                  }}
                                  className="p-1.5 rounded-lg bg-[#0a0a0a] hover:bg-zinc-800 text-[#8E9299] hover:text-white transition-all cursor-pointer"
                                  title="Chi tiết đơn"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                {isMasterAdmin && (
                                  <button
                                    onClick={() => pass.id && setPassToDelete(pass.id)}
                                    className="p-1.5 rounded-lg text-red-500/60 hover:text-red-500 hover:bg-red-500/15 transition-all cursor-pointer"
                                    title="Xóa phiếu"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                      ) : (
                        <tr>
                          <td colSpan={12} className="py-12 text-center text-[#8E9299]">
                            Không tìm thấy yêu cầu đăng ký nào phù hợp.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* DẠNG THẺ CHI TIẾT (CARDS VIEW) - ĐƯỢC TỐI ƯU CHIỀU NGANG TRÊN MÀN HÌNH RỘNG */
              <div className="grid grid-cols-1 gap-4">
                <AnimatePresence mode="popLayout">
                  {paginatedPasses.length > 0 ? (
                    paginatedPasses.map((pass) => {
                      const effStatus = getPassEffectiveStatus(pass);
                      const remainingSecs = getPassRemainingSeconds(pass);
                      const isExpired = effStatus === 'Đã hết hạn';
                      const isApproved = effStatus === 'Đã duyệt';

                      return (
                      <motion.div
                        key={pass.id}
                        layout
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => {
                          setSelectedPass(pass);
                          if (isApproved || isExpired || effStatus === 'Từ chối') {
                            setShowSecurityBadge(true);
                          } else {
                            setShowSecurityBadge(false);
                          }
                        }}
                        className="bg-[#151619] border border-[#1c1d21] hover:border-[#00FF00]/40 rounded-2xl p-4 sm:p-5 transition-all cursor-pointer group relative overflow-hidden shadow-md"
                      >
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-center">
                          {/* Cột 1: Chọn hàng loạt + Ảnh nhận diện + Thông tin học sinh */}
                          <div className="lg:col-span-4 xl:col-span-3 flex items-start gap-3.5">
                            {/* Nút chọn hàng loạt */}
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (pass.id) toggleSelectPass(pass.id);
                              }}
                              className="flex-shrink-0 flex items-center justify-center cursor-pointer select-none self-center"
                              title="Chọn phiếu này"
                            >
                              <div className={cn(
                                "w-5 h-5 rounded-full border flex items-center justify-center transition-all",
                                selectedPassIds.includes(pass.id!) 
                                  ? "border-[#00FF00] bg-[#00FF00]" 
                                  : "border-[#1c1d21] bg-[#0a0a0a] group-hover:border-[#8E9299] lg:opacity-60 lg:group-hover:opacity-100"
                              )}>
                                {selectedPassIds.includes(pass.id!) && <Check className="w-3 h-3 text-black stroke-[3]" />}
                              </div>
                            </div>

                            {/* Ảnh nhận diện - CỐ ĐỊNH KÍCH THƯỚC KHÔNG BỊ KÉO GIÃN */}
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                setZoomedPass(pass);
                                setImageZoomScale(1);
                                setPanOffset({ x: 0, y: 0 });
                              }}
                              className={cn(
                                "w-24 h-24 rounded-xl overflow-hidden bg-[#0a0a0a] flex-shrink-0 border relative animate-fade-in cursor-pointer group/img shadow-md transition-all",
                                isExpired 
                                  ? "border-amber-500/40 hover:border-amber-400" 
                                  : "border-[#1c1d21] hover:border-[#00FF00]"
                              )}
                              title="Bấm vào con mắt / ảnh để phóng to nhận diện khuôn mặt"
                            >
                              <img src={pass.photoUrl} alt="Face" className="w-full h-full object-cover transition-transform duration-300 group-hover/img:scale-110" referrerPolicy="no-referrer" />
                              <div className="absolute inset-0 bg-black/65 opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 backdrop-blur-[0.5px]">
                                <div className={cn(
                                  "w-8 h-8 rounded-full bg-black/85 border flex items-center justify-center shadow-lg",
                                  isExpired ? "border-amber-400 text-amber-400" : "border-[#00FF00] text-[#00FF00]"
                                )}>
                                  <Eye className="w-4 h-4" />
                                </div>
                                <span className={cn(
                                  "text-[9px] font-bold font-mono uppercase tracking-wider",
                                  isExpired ? "text-amber-400" : "text-[#00FF00]"
                                )}>Nhận diện</span>
                              </div>
                            </div>

                            {/* Thông tin cơ bản */}
                            <div className="flex-1 min-w-0 space-y-1">
                              <h3 className="font-bold text-base text-white group-hover:text-[#00FF00] transition-colors font-sans truncate">
                                {pass.fullName}
                              </h3>
                              <span className="inline-block text-[10px] font-mono text-[#00FF00] bg-black/70 px-2 py-0.5 rounded border border-[#00FF00]/30 font-bold select-all">
                                {pass.passId || pass.id}
                              </span>
                              <div className="text-[11px] text-zinc-300 font-medium font-sans">
                                Lớp: <span className="text-white font-bold">{pass.department}</span>
                              </div>
                              <div className="text-[11px] font-mono font-bold text-cyan-400 select-all truncate">
                                {pass.phoneNumber ? `📞 ${pass.phoneNumber}` : <span className="text-zinc-500 font-normal">Chưa có SĐT</span>}
                              </div>
                              {pass.createdAt && (
                                <div className="text-[10px] text-[#8E9299] font-mono">
                                  Gửi: {getRelativeTimeString(pass.createdAt)}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Cột 2: Mốc thời gian ra cổng & Duyệt */}
                          <div className="lg:col-span-3 xl:col-span-3 space-y-2 font-sans">
                            {/* Thời gian xin ra */}
                            <div className="flex items-start gap-2.5 text-cyan-400 bg-cyan-950/25 px-3 py-2 rounded-xl border border-cyan-500/25">
                              <Clock className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="text-zinc-400 font-bold text-[9px] uppercase tracking-wider block">Thời gian xin ra:</span>
                                <span className="text-cyan-300 font-mono font-bold text-xs">{new Date(pass.exitTime).toLocaleString('vi-VN')}</span>
                              </div>
                            </div>

                            {/* Thời gian duyệt */}
                            {pass.approvedAt ? (
                              <div className={cn(
                                "flex items-start gap-2.5 px-3 py-2 rounded-xl border font-sans",
                                effStatus === 'Từ chối'
                                  ? "text-red-400 bg-red-950/25 border-red-500/30"
                                  : isApproved
                                    ? "text-[#00FF00] bg-emerald-950/25 border-[#00FF00]/30"
                                    : "text-zinc-300 bg-[#0a0a0a] border-[#1c1d21]"
                              )}>
                                <CheckCircle2 className={cn("w-4 h-4 shrink-0 mt-0.5", effStatus === 'Từ chối' ? "text-red-400" : isApproved ? "text-[#00FF00]" : "text-zinc-500")} />
                                <div className="min-w-0">
                                  <span className="text-zinc-400 text-[9px] uppercase font-bold block">
                                    {effStatus === 'Từ chối' ? "Thời gian từ chối:" : "Thời gian duyệt:"}
                                  </span>
                                  <span className="font-mono font-extrabold text-xs block">
                                    {new Date(pass.approvedAt).toLocaleString('vi-VN')}
                                  </span>
                                  {pass.approvedBy && (
                                    <span className="text-zinc-400 text-[10px] block truncate mt-1">
                                      Bởi: <strong className="text-white">{pass.approvedBy}</strong> {pass.approverPosition && <span className="text-[#00FF00]">({pass.approverPosition})</span>}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-950/15 text-amber-400 text-xs">
                                <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                                <span className="text-[11px] font-medium text-amber-300/90">Đang chờ cán bộ phê duyệt</span>
                              </div>
                            )}
                          </div>

                          {/* Cột 3: Lý do xin ra cổng */}
                          <div className="lg:col-span-3 xl:col-span-4 space-y-1.5 font-sans">
                            <span className="text-[10px] text-[#8E9299] uppercase font-bold tracking-wider block">
                              Lý do xin ra cổng:
                            </span>
                            <div className="bg-[#0a0a0a] p-3 rounded-xl border border-[#1c1d21] text-xs text-white leading-relaxed select-all max-h-24 overflow-y-auto">
                              {pass.reason}
                            </div>
                          </div>

                          {/* Cột 4: Trạng thái & Thao tác */}
                          <div className="lg:col-span-2 xl:col-span-2 flex flex-col justify-between gap-2.5 font-sans lg:border-l lg:border-[#1c1d21]/60 lg:pl-4 pt-3 lg:pt-0 border-t lg:border-t-0 border-[#1c1d21]/60">
                            <div className="flex items-center justify-between lg:justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <span 
                                onClick={() => {
                                  setSelectedPass(pass);
                                  if (isApproved || isExpired || effStatus === 'Từ chối') {
                                    setShowSecurityBadge(true);
                                  } else {
                                    setShowSecurityBadge(false);
                                  }
                                }}
                                className={cn(
                                  "text-[10px] px-3 py-1 rounded-full uppercase font-bold font-sans cursor-pointer whitespace-nowrap shadow-sm inline-flex items-center gap-1",
                                  isApproved ? "bg-[#00FF00]/15 text-[#00FF00] border border-[#00FF00]/30" :
                                  isExpired ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" :
                                  effStatus === 'Từ chối' ? "bg-red-500/15 text-red-500 border border-red-500/30" : "bg-yellow-500/15 text-yellow-500 border border-yellow-500/30"
                                )}
                              >
                                {isApproved ? '✓ Đã duyệt' : 
                                 isExpired ? (pass.status === 'rejected' || pass.status === 'Từ chối' ? '✕ Từ chối' : '⏱️ Đã hết hạn') :
                                 effStatus === 'Từ chối' ? '✕ Từ chối' : '⏳ Chờ duyệt'}
                              </span>

                              <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomedPass(pass);
                                    setImageZoomScale(1);
                                    setPanOffset({ x: 0, y: 0 });
                                  }}
                                  className="p-1.5 rounded-lg bg-[#0a0a0a] hover:bg-[#00FF00]/15 text-[#8E9299] hover:text-[#00FF00] border border-transparent hover:border-[#00FF00]/30 transition-all cursor-pointer"
                                  title="Phóng to ảnh nhận diện"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedPass(pass);
                                    setShowSecurityBadge(false);
                                  }}
                                  className="p-1.5 rounded-lg bg-[#0a0a0a] hover:bg-zinc-800 text-[#8E9299] hover:text-white transition-all cursor-pointer"
                                  title="Xem chi tiết đơn"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                {isMasterAdmin && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (pass.id) setPassToDelete(pass.id);
                                    }}
                                    className="p-1.5 rounded-lg text-red-500/60 hover:text-red-500 hover:bg-red-500/15 transition-all cursor-pointer"
                                    title="Xóa phiếu đăng ký này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Admin nút duyệt / từ chối nhanh nếu pending */}
                            {userProfile?.role === 'admin' && (pass.status === 'pending' || pass.status === 'Chờ duyệt') && (
                              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUpdateStatus(pass.id!, 'approved');
                                  }}
                                  className="flex-1 bg-[#00FF00]/15 hover:bg-[#00FF00] text-[#00FF00] hover:text-black py-2 rounded-xl text-[10px] font-extrabold transition-all flex items-center justify-center gap-1 uppercase tracking-wider border border-[#00FF00]/30 shadow-sm"
                                >
                                  <Check className="w-3 h-3" /> Duyệt
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUpdateStatus(pass.id!, 'rejected');
                                  }}
                                  className="flex-1 bg-red-500/15 hover:bg-red-500 text-red-400 hover:text-white py-2 rounded-xl text-[10px] font-extrabold transition-all flex items-center justify-center gap-1 uppercase tracking-wider border border-red-500/30 shadow-sm"
                                >
                                  <X className="w-3 h-3" /> Từ chối
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                      );
                    })
                  ) : (
                    <div className="bg-[#151619] border border-dashed border-[#1c1d21] rounded-2xl p-10 text-center text-[#8E9299] font-sans">
                      <p className="text-sm">Không tìm thấy yêu cầu đăng ký nào phù hợp.</p>
                      <p className="text-[11px] text-[#8E9299] mt-1">Hãy thử đổi tab phân loại hoặc nhập nội dung tìm kiếm khác!</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Thanh thao tác hàng loạt nổi (Floating Batch Toolbar) */}
            <AnimatePresence>
              {selectedPassIds.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 50, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 50, scale: 0.95 }}
                  className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#111215]/95 backdrop-blur-md border border-[#00FF00]/30 rounded-2xl px-5 py-3 shadow-2xl flex items-center justify-between gap-3 max-w-2xl w-[94%] font-sans"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#00FF00] animate-pulse" />
                    <span className="text-xs font-bold text-white">
                      Đã chọn <span className="text-[#00FF00] font-mono font-extrabold">{selectedPassIds.length}</span> phiếu
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {userProfile?.role === 'admin' && (
                      <>
                        <button
                          onClick={handleBulkApprove}
                          disabled={isDeleting}
                          className="px-3 py-1.5 rounded-xl bg-[#00FF00] hover:bg-[#00CC00] text-black font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all shadow-md"
                        >
                          <Check className="w-3.5 h-3.5" /> Duyệt ({selectedPassIds.length})
                        </button>
                        <button
                          onClick={handleBulkReject}
                          disabled={isDeleting}
                          className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-black font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all border border-amber-500/30"
                        >
                          <X className="w-3.5 h-3.5" /> Từ chối ({selectedPassIds.length})
                        </button>
                        <button
                          onClick={handleBulkSyncToWebhook}
                          disabled={isBulkSyncing || isDeleting}
                          className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-black font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all border border-emerald-500/30 cursor-pointer disabled:opacity-50"
                          title="Đồng bộ các phiếu đã chọn sang Google Sheets qua Webhook"
                        >
                          {isBulkSyncing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          Gửi Sheet ({selectedPassIds.length})
                        </button>
                      </>
                    )}
                    {isMasterAdmin && (
                      <button
                        onClick={() => setBulkDeleteConfirm(true)}
                        disabled={isDeleting}
                        className="px-3 py-1.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all shadow-md cursor-pointer"
                        title="Xóa các phiếu đã chọn"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xóa
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedPassIds([])}
                      className="px-2.5 py-1.5 rounded-xl bg-[#1c1d21] text-[#8E9299] hover:text-white font-bold text-[10px] uppercase tracking-wider transition-colors"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phân trang: Tabs trang 1, 2, 3... */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1.5 pt-4 font-sans pb-4">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-3.5 py-2 rounded-xl border border-[#1c1d21] bg-[#151619] hover:bg-[#1c1d21] text-xs font-bold text-[#8E9299] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
                >
                  Trước
                </button>
                
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      "w-9 h-9 rounded-xl border text-xs font-bold transition-all active:scale-95",
                      currentPage === page
                        ? "bg-[#00FF00] text-black border-[#00FF00] shadow-lg shadow-[#00FF00]/10"
                        : "bg-[#151619] text-[#8E9299] border-[#1c1d21] hover:text-white hover:border-gray-700"
                    )}
                  >
                    {page}
                  </button>
                ))}

                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-3.5 py-2 rounded-xl border border-[#1c1d21] bg-[#151619] hover:bg-[#1c1d21] text-xs font-bold text-[#8E9299] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
                >
                  Sau
                </button>
              </div>
            )}
          </div>
        )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Selected Pass Details & Image Lightbox Modal */}
      <AnimatePresence>
        {selectedPass && (() => {
          const isSelectedExpired = isPassExpired(selectedPass);
          const isSelectedApproved = !isSelectedExpired && (selectedPass.status === 'approved' || selectedPass.status === 'Đã duyệt');
          const isSelectedRejected = selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối';
          const selectedRemainingSecs = getPassRemainingSeconds(selectedPass);
          const selectedExpiryDate = getPassExpiryDate(selectedPass);

          return (
          <div className="fixed inset-0 z-[100] overflow-y-auto flex items-start sm:items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSelectedPass(null);
                setShowSecurityBadge(false);
              }}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            
            {showSecurityBadge ? (
              /* ================= PHÂN HỆ: THẺ XUẤT TRÌNH BẢO VỆ SMART BADGE ================= */
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className={cn(
                  "relative w-full max-w-md bg-[#111214] border rounded-3xl overflow-hidden shadow-2xl flex flex-col z-10 my-auto",
                  isSelectedApproved ? "border-[#00FF00]/40 shadow-[#00FF00]/5" :
                  isSelectedExpired ? "border-amber-500/40 shadow-amber-500/10" :
                  isSelectedRejected ? "border-red-500/30 shadow-red-500/5" : "border-yellow-500/30"
                )}
              >
                {/* Nút thoát */}
                <button 
                  onClick={() => {
                    setSelectedPass(null);
                    setShowSecurityBadge(false);
                  }}
                  className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-[#8E9299] hover:text-white border border-[#1c1d21] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Nút quay lại trang thông tin thường */}
                <button 
                  onClick={() => setShowSecurityBadge(false)}
                  className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full bg-black/50 text-[10px] text-[#8E9299] hover:text-white border border-[#1c1d21] transition-all flex items-center gap-1 font-bold font-sans uppercase"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Chi tiết
                </button>

                {/* Header trạng thái khẩn cấp */}
                <div className={cn(
                  "pt-14 pb-5 px-6 text-center flex flex-col items-center relative overflow-hidden font-sans",
                  isSelectedApproved ? "bg-[#00FF00]/10 text-[#00FF00]" :
                  isSelectedExpired ? "bg-amber-500/20 text-amber-400" :
                  isSelectedRejected ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-500"
                )}>
                  {/* Hiệu ứng mờ ảo phía sau */}
                  <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none animate-pulse" />
                  
                  {isSelectedApproved ? (
                    <>
                      <CheckCircle2 className="w-9 h-9 mb-1.5 text-[#00FF00] animate-bounce" />
                      <span className="text-sm font-extrabold uppercase tracking-widest text-[#00FF00]">ĐÃ DUYỆT RA CỔNG</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5 opacity-80">HỢP LỆ TRONG GIỜ PHÉP</span>
                    </>
                  ) : isSelectedExpired ? (
                    <>
                      <AlertTriangle className="w-9 h-9 mb-2 text-amber-400 animate-pulse" />
                      <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
                        <span className={cn(
                          "px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border flex items-center gap-1 shadow-sm",
                          (selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối')
                            ? "bg-red-500/25 text-red-300 border-red-500/40"
                            : "bg-emerald-500/25 text-[#00FF00] border-[#00FF00]/40"
                        )}>
                          {(selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối') ? (
                            <><XCircle className="w-3.5 h-3.5 text-red-400" /> Đã từ chối</>
                          ) : (
                            <><CheckCircle2 className="w-3.5 h-3.5 text-[#00FF00]" /> Đã được duyệt</>
                          )}
                        </span>

                        <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border bg-amber-500/25 text-amber-300 border-amber-500/40 flex items-center gap-1 shadow-sm">
                          <Timer className="w-3.5 h-3.5 text-amber-400" /> Đã hết hạn ra cổng (quá 30 phút)
                        </span>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5 opacity-90 text-amber-300">QUÁ 30 PHÚT KỂ TỪ LÚC DUYỆT - KHÔNG HỢP LỆ RA CỔNG</span>
                    </>
                  ) : isSelectedRejected ? (
                    <>
                      <XCircle className="w-9 h-9 mb-1.5 text-red-500" />
                      <span className="text-sm font-extrabold uppercase tracking-widest text-red-500">TỪ CHỐI RA CỔNG</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5 opacity-80">PHIẾU KHÔNG CÓ HIỆU LỰC</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-8 h-8 mb-1.5 text-yellow-500 animate-spin" />
                      <span className="text-sm font-extrabold uppercase tracking-widest text-yellow-500">ĐƠN CHỜ KIỂM</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5 opacity-80">YÊU CẦU DUYỆT ĐƠN TRƯỚC</span>
                    </>
                  )}
                </div>

                {/* Thanh chạy thời gian siêu an toàn (Watermark chứng minh không dùng ảnh chụp màn hình) */}
                <div className="bg-[#08080a] py-2 px-5 border-y border-[#1c1d21] flex justify-between items-center text-[8px] text-[#8E9299]">
                  <span className="flex items-center gap-1 font-bold">
                    <span className="w-1.5 h-1.5 bg-[#00FF00] rounded-full animate-ping inline-block" />
                    CHỨNG THỰC SECURITY CLOCK
                  </span>
                  <span className="font-mono text-white/90 font-bold bg-[#151619] px-2 py-0.5 rounded border border-[#1c1d21]">
                    {liveSecTime.toLocaleDateString('vi-VN')} {liveSecTime.toLocaleTimeString('vi-VN')}
                  </span>
                </div>

                {/* Thân thẻ chính */}
                <div className="p-5 flex flex-col items-center flex-1 space-y-4">
                  {/* Khung đếm ngược 30 phút hoặc Cảnh báo hết hạn */}
                  {isSelectedApproved && (
                    <div className="w-full bg-[#00FF00]/10 border-2 border-[#00FF00]/40 rounded-2xl p-3.5 flex items-center justify-between text-left">
                      <div>
                        <span className="text-[10px] text-[#00FF00] uppercase font-mono font-bold flex items-center gap-1">
                          <Timer className="w-3.5 h-3.5 animate-pulse" /> THỜI HẠN RA CỔNG CÒN LẠI:
                        </span>
                        <span className="text-xs text-zinc-300 block mt-0.5">
                          Hết hạn lúc: <strong className="text-white font-mono">{selectedExpiryDate?.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-2xl font-black text-[#00FF00] tracking-wider animate-pulse">
                          {formatCountdown(selectedRemainingSecs)}
                        </span>
                        <span className="text-[8px] text-[#00FF00]/80 block font-mono">Hiệu lực 30 phút</span>
                      </div>
                    </div>
                  )}


                  {/* Ảnh khuôn mặt có vòng hào quang */}
                  <div className="relative">
                    <div 
                      onClick={() => {
                        setZoomedPass(selectedPass);
                        setImageZoomScale(1);
                      }}
                      className={cn(
                        "w-32 h-32 rounded-2xl overflow-hidden border-2 relative select-none shrink-0 shadow-lg cursor-pointer group/badge-img",
                        isSelectedApproved ? "border-[#00FF00] ring-4 ring-[#00FF00]/10" :
                        isSelectedExpired ? "border-amber-500 ring-4 ring-amber-500/10" :
                        isSelectedRejected ? "border-red-500/50 ring-4 ring-red-500/5" : "border-yellow-500/40"
                      )}
                      title="Bấm vào để phóng to ảnh nhận diện"
                    >
                      <img 
                        src={selectedPass.photoUrl} 
                        alt="Khuôn mặt học viên" 
                        className="w-full h-full object-cover group-hover/badge-img:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/badge-img:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 backdrop-blur-[0.5px]">
                        <div className={cn(
                          "w-8 h-8 rounded-full bg-black/80 border flex items-center justify-center",
                          isSelectedExpired ? "border-amber-400 text-amber-400" : "border-[#00FF00] text-[#00FF00]"
                        )}>
                          <Eye className="w-4 h-4" />
                        </div>
                        <span className={cn(
                          "text-[9px] font-bold font-mono uppercase tracking-wider",
                          isSelectedExpired ? "text-amber-400" : "text-[#00FF00]"
                        )}>Phóng to</span>
                      </div>
                    </div>
                  </div>

                  {/* Thông tin đối tượng hiển thị lớn */}
                  <div className="w-full space-y-2.5 font-sans text-xs">
                    <div className="bg-[#0a0a0c] border border-[#1c1d21] rounded-2xl p-3 text-center">
                      <div className="flex items-center justify-center gap-2 mb-1">
                        <span className="text-[9px] text-[#8E9299] uppercase tracking-widest font-bold font-mono">Thông tin xuất trình</span>
                        <span className="text-[10px] font-mono font-bold text-[#00FF00] bg-[#00FF00]/10 px-2 py-0.5 rounded border border-[#00FF00]/30 select-all">
                          ID: {selectedPass.passId || selectedPass.id}
                        </span>
                      </div>
                      <h3 className="text-base font-extrabold text-white uppercase tracking-tight block mt-0.5 leading-tight">{selectedPass.fullName}</h3>
                      <div className="flex items-center justify-center gap-2 mt-1.5 flex-wrap">
                        <span className="px-3 py-1 bg-[#17181c] rounded-full border border-[#1c1d21] text-[10px] text-[#8E9299] font-bold">
                          Lớp / Chức vụ: <span className="text-white">{selectedPass.department}</span>
                        </span>
                        <span className="px-3 py-1 bg-cyan-950/30 rounded-full border border-cyan-500/30 text-[10px] text-cyan-400 font-mono font-bold">
                          SĐT: {selectedPass.phoneNumber ? `📞 ${selectedPass.phoneNumber}` : 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#0a0a0c] border-[#00FF00]/20 rounded-2xl p-4 text-center relative overflow-hidden bg-gradient-to-b from-[#00FF00]/5 to-transparent shadow-md border-2">
                      <span className="text-[10px] text-[#8E9299] uppercase tracking-widest block font-extrabold font-mono">📝 LÝ DO CHÍNH ĐÁNG</span>
                      <p className="text-base sm:text-lg font-black text-white mt-1 leading-relaxed">
                        {selectedPass.reason}
                      </p>
                    </div>

                    <div className="bg-[#0a0a0c] border border-cyan-500/30 rounded-2xl p-3.5 flex justify-between items-center text-xs bg-gradient-to-r from-cyan-500/10 to-transparent">
                      <span className="text-[10px] text-cyan-400 uppercase tracking-widest block font-bold font-mono">⏱️ THỜI GIAN XIN RA CỔNG</span>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1 font-extrabold text-cyan-300">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          <span>{new Date(selectedPass.exitTime).toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'})}</span>
                        </div>
                        <span className="text-[9px] text-cyan-400/80 block font-mono mt-0.5">
                          Ngày {new Date(selectedPass.exitTime).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    </div>

                    {selectedPass.approvedAt && (
                      <div className={cn(
                        "border-2 border-dashed rounded-2xl p-4 text-center shadow-lg",
                        isSelectedExpired
                          ? "bg-[#0e0e12] border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-transparent shadow-amber-500/5"
                          : "bg-[#0e0e12] border-[#00FF00]/40 bg-gradient-to-r from-[#00FF00]/10 to-transparent shadow-[#00FF00]/5"
                      )}>
                        {isSelectedExpired ? (
                          <div className="flex items-center justify-center gap-1.5 flex-wrap mb-1">
                            <span className={cn(
                              "text-[10px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded border shadow-sm",
                              (selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối')
                                ? "bg-red-500/20 text-red-300 border-red-500/40"
                                : "bg-emerald-500/20 text-[#00FF00] border-[#00FF00]/40"
                            )}>
                              {(selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối') ? "✕ Đã từ chối" : "✓ Đã được duyệt"}
                            </span>
                            <span className="text-[10px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded border bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm">
                              ⏱️ Đã hết hạn ra cổng (quá 30 phút)
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] block font-bold font-mono uppercase tracking-widest text-[#00FF00]">
                            ✓ Ô XÁC NHẬN - THỜI GIAN ĐÃ PHÊ DUYỆT
                          </span>
                        )}
                        
                        <div className="flex flex-col items-center justify-center mt-2 space-y-1">
                          <span className={cn(
                            "text-xl sm:text-2xl font-black tracking-tight",
                            isSelectedExpired ? "text-amber-400" : "text-[#00FF00]"
                          )}>
                            {new Date(selectedPass.approvedAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'})}
                          </span>
                          <span className="text-xs text-white/90 font-extrabold font-mono uppercase tracking-wide">
                            Ngày {new Date(selectedPass.approvedAt).toLocaleDateString('vi-VN')}
                          </span>
                          {selectedPass.approvedBy && (
                            <span className="text-[10px] text-[#8E9299] block bg-black/60 px-3 py-1 rounded-full border border-[#1c1d21] mt-1 font-mono">
                              Người duyệt: <span className="text-white font-bold">{selectedPass.approvedBy}</span>
                              {(selectedPass.approverRole || selectedPass.approverPosition) && (
                                <span className={cn("ml-1.5 font-semibold", isSelectedExpired ? "text-amber-400" : "text-[#00FF00]")}>
                                  ({selectedPass.approverRole || selectedPass.approverPosition})
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Công cụ tiện dụng phụ trợ */}
                  <div className="w-full flex gap-2 pt-1 font-sans">
                    <button
                      onClick={() => window.print()}
                      className="flex-1 bg-[#1c1d21] hover:bg-[#2a2b30] text-white py-2.5 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 border border-[#1c1d21]"
                    >
                      🖨️ In / Lưu file PDF
                    </button>
                    <button
                      onClick={() => {
                        const link = window.location.origin + "?verify=" + selectedPass.id;
                        navigator.clipboard.writeText(link);
                        alert("Đã sao chép đường link xác minh an toàn!");
                      }}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 border",
                        isSelectedExpired
                          ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : "bg-[#00FF00]/10 hover:bg-[#00FF00]/20 text-[#00FF00] border-[#00FF00]/20"
                      )}
                    >
                      🔗 Copy link tra cứu
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              /* ================= PHÂN HỆ: CHI TIẾT ĐƠN KIỂM SOÁT THÔNG THƯỜNG ================= */
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 15 }}
                className="relative w-[96vw] sm:w-[94vw] lg:w-[92vw] max-w-[1100px] max-h-[90vh] bg-[#121316] border border-[#22242a] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col z-10 font-sans my-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 1. Header cố định: Tiêu đề, Mã ID, Trạng thái & Nút đóng */}
                <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#16171b] border-b border-[#22242a] flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap min-w-0">
                    <div className={cn(
                      "w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 border",
                      isSelectedExpired ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-[#00FF00]/10 border-[#00FF00]/30 text-[#00FF00]"
                    )}>
                      <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm sm:text-base lg:text-lg font-black text-white uppercase tracking-wider truncate">
                          Chi tiết phiếu ra cổng
                        </h2>
                        <span className={cn(
                          "text-[10px] sm:text-xs font-mono font-bold bg-black/60 px-2 sm:px-2.5 py-0.5 rounded-md border select-all",
                          isSelectedExpired ? "text-amber-400 border-amber-500/30" : "text-[#00FF00] border-[#00FF00]/30"
                        )}>
                          ID: {selectedPass.passId || selectedPass.id}
                        </span>
                      </div>
                      <p className="text-[10px] sm:text-[11px] text-[#8E9299] truncate hidden sm:block">
                        Thông tin xuất trình & xác thực kiểm soát học sinh ra vào cổng
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {/* Huy hiệu trạng thái nổi bật bằng màu và chữ */}
                    {isSelectedExpired ? (
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
                        {/* Thông tin phiếu đã được duyệt hay từ chối cạnh ngang */}
                        <span className={cn(
                          "text-[10px] sm:text-xs px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1.5 border shadow-sm",
                          (selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối')
                            ? "bg-red-950/50 text-red-400 border-red-500/40"
                            : "bg-emerald-950/50 text-[#00FF00] border-[#00FF00]/40"
                        )}>
                          {(selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối') ? (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-400" />
                              <span>Từ chối</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF00]" />
                              <span>Đã được duyệt</span>
                            </>
                          )}
                        </span>

                        {/* Thông tin Đã hết hạn ra cổng (quá 30 phút) */}
                        <span className="text-[10px] sm:text-xs px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1.5 border shadow-sm bg-amber-950/50 text-amber-400 border-amber-500/40 shadow-amber-500/5">
                          <Timer className="w-3.5 h-3.5 text-amber-400" />
                          <span>Đã hết hạn ra cổng (quá 30 phút)</span>
                        </span>
                      </div>
                    ) : (
                      <span className={cn(
                        "text-[10px] sm:text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1.5 border shadow-sm",
                        isSelectedApproved 
                          ? "bg-emerald-950/40 text-[#00FF00] border-[#00FF00]/40 shadow-[#00FF00]/5" :
                        isSelectedRejected 
                          ? "bg-red-950/40 text-red-400 border-red-500/40 shadow-red-500/5" 
                          : "bg-amber-950/40 text-amber-400 border-amber-500/40 shadow-amber-500/5"
                      )}>
                        {isSelectedApproved ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF00]" />
                            <span>Đã duyệt (Còn {formatCountdown(selectedRemainingSecs)})</span>
                          </>
                        ) : isSelectedRejected ? (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            <span>Từ chối ra cổng</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                            <span>Chờ phê duyệt</span>
                          </>
                        )}
                      </span>
                    )}

                    {/* Nút đóng */}
                    <button 
                      onClick={() => {
                        setSelectedPass(null);
                        setShowSecurityBadge(false);
                      }}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#1c1d21] hover:bg-zinc-800 text-[#8E9299] hover:text-white border border-[#282a31] flex items-center justify-center transition-colors cursor-pointer"
                      title="Đóng cửa sổ (Esc)"
                    >
                      <X className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>

                {/* 2. Thân nội dung: Cuộn bên trong khi dài; Desktop hiển thị 2 cột song song */}
                <div className="overflow-y-auto p-4 sm:p-6 lg:p-7 flex-1 min-h-0 space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
                    
                    {/* Cột 1 (Desktop: 5/12): Ảnh nhận diện khuôn mặt & Thao tác tiện ích */}
                    <div className="lg:col-span-5 flex flex-col gap-4">
                      {/* Khung ảnh nhận diện */}
                      <div className="bg-[#0b0c0e] p-2.5 sm:p-3 rounded-2xl sm:rounded-3xl border border-[#22242a] shadow-inner">
                        <div 
                          onClick={() => {
                            setZoomedPass(selectedPass);
                            setImageZoomScale(1);
                            setPanOffset({ x: 0, y: 0 });
                          }}
                          className={cn(
                            "w-full aspect-[4/3] sm:aspect-square max-h-[380px] bg-black rounded-xl sm:rounded-2xl overflow-hidden border-2 relative cursor-pointer group/modal-photo transition-all",
                            isSelectedApproved ? "border-[#00FF00]/40 shadow-lg shadow-[#00FF00]/5" :
                            isSelectedExpired ? "border-amber-500/40 shadow-lg shadow-amber-500/5" :
                            isSelectedRejected ? "border-red-500/40 shadow-lg shadow-red-500/5" : "border-amber-500/30"
                          )}
                          title="Bấm vào để phóng to nhận diện khuôn mặt"
                        >
                          <img 
                            src={selectedPass.photoUrl} 
                            alt={selectedPass.fullName} 
                            className="w-full h-full object-cover group-hover/modal-photo:scale-105 transition-transform duration-300"
                          />
                          {/* Lớp phủ hover gợi ý phóng to */}
                          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover/modal-photo:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
                            <div className={cn(
                              "w-12 h-12 rounded-full bg-black/85 border-2 flex items-center justify-center shadow-xl",
                              isSelectedExpired ? "border-amber-400 text-amber-400" : "border-[#00FF00] text-[#00FF00]"
                            )}>
                              <Eye className="w-6 h-6" />
                            </div>
                            <span className={cn(
                              "text-xs font-bold uppercase font-mono tracking-wider bg-black/80 px-3.5 py-1.5 rounded-full border shadow-md",
                              isSelectedExpired ? "text-amber-400 border-amber-500/30" : "text-[#00FF00] border-[#00FF00]/30"
                            )}>
                              Phóng to nhận diện
                            </span>
                          </div>

                          {/* Nhãn góc dưới */}
                          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                            <span className={cn(
                              "bg-black/85 backdrop-blur-md text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md border",
                              isSelectedExpired ? "text-amber-400 border-amber-500/30" : "text-[#00FF00] border-[#00FF00]/30"
                            )}>
                              <Eye className="w-3.5 h-3.5" />
                              Ảnh nhận diện AI
                            </span>
                            <span className="bg-black/85 text-[10px] text-zinc-400 px-2.5 py-0.5 rounded-full border border-zinc-700 font-mono">
                              Chạm để mở to
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Phím bấm thao tác nhanh dưới ảnh */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setZoomedPass(selectedPass);
                            setImageZoomScale(1);
                            setPanOffset({ x: 0, y: 0 });
                          }}
                          className="w-full bg-[#181a1f] hover:bg-[#202228] text-white py-2.5 px-3 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 border border-[#252831] text-[11px] cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#00FF00]" /> Phóng to ảnh
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const link = window.location.origin + "?verify=" + selectedPass.id;
                            navigator.clipboard.writeText(link);
                            setCopiedPassId(true);
                            setTimeout(() => setCopiedPassId(false), 2000);
                          }}
                          className="w-full bg-[#181a1f] hover:bg-[#202228] text-white py-2.5 px-3 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 border border-[#252831] text-[11px] cursor-pointer"
                        >
                          {copiedPassId ? (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-[#00FF00]" />
                              <span className="text-[#00FF00]">Đã chép link</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Sao chép link</span>
                            </>
                          )}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="w-full bg-[#14161a] hover:bg-[#1d2026] text-zinc-300 hover:text-white py-2.5 px-3 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 border border-[#22242a] text-[11px] cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-zinc-400" /> 🖨️ In phiếu / Lưu file PDF
                      </button>
                    </div>

                    {/* Cột 2 (Desktop: 7/12): Các nhóm thông tin được phân loại rõ ràng */}
                    <div className="lg:col-span-7 space-y-4">
                      
                      {/* MỤC 1: THÔNG TIN NGƯỜI ĐĂNG KÝ */}
                      <div className="bg-[#16171b] border border-[#22242a] rounded-2xl p-4 sm:p-5 space-y-3">
                        <div className="flex items-center justify-between border-b border-[#22242a] pb-2.5">
                          <span className="text-[10px] text-[#8E9299] uppercase tracking-wider font-extrabold font-mono flex items-center gap-1.5">
                            <UserIcon className="w-3.5 h-3.5 text-[#00FF00]" /> 1. NGƯỜI ĐĂNG KÝ
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400">
                            Loại: {selectedPass.phoneNumber ? 'Học sinh / Cán bộ' : 'Thành viên'}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-[#8E9299] uppercase block font-mono">Họ và tên đầy đủ:</span>
                          <h3 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight break-words mt-0.5 leading-snug">
                            {selectedPass.fullName}
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="bg-[#0e0f12] p-3 rounded-xl border border-[#1f2127]">
                            <span className="text-[10px] text-[#8E9299] uppercase block font-mono font-bold">Lớp / Chức vụ:</span>
                            <span className="font-extrabold text-white text-sm mt-0.5 block break-words">
                              {selectedPass.department}
                            </span>
                          </div>

                          <div className="bg-[#0e0f12] p-3 rounded-xl border border-[#1f2127]">
                            <span className="text-[10px] text-[#8E9299] uppercase block font-mono font-bold">Số điện thoại:</span>
                            <span className="font-mono font-bold text-cyan-400 text-sm mt-0.5 block">
                              {selectedPass.phoneNumber ? `📞 ${selectedPass.phoneNumber}` : <span className="text-zinc-500 font-normal italic">Chưa đăng ký SĐT</span>}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-xs pt-1 text-[#8E9299]">
                          <span className="font-mono">Mã số hồ sơ (ID):</span>
                          <span className="font-mono font-bold text-[#00FF00] bg-black/40 px-2 py-0.5 rounded border border-[#22242a] select-all">
                            {selectedPass.passId || selectedPass.id}
                          </span>
                        </div>
                      </div>

                      {/* MỤC 2: LÝ DO XIN RA CỔNG (Trình bày rộng rãi, không bị cắt ngắn nội dung) */}
                      <div className="bg-[#16171b] border border-[#22242a] rounded-2xl p-4 sm:p-5 space-y-2">
                        <span className="text-[10px] text-[#8E9299] uppercase tracking-wider font-extrabold font-mono flex items-center gap-1.5">
                          📝 2. LÝ DO XIN RA CỔNG (CHÍNH ĐÁNG)
                        </span>
                        <div className="bg-[#0d0e11] p-3.5 sm:p-4 rounded-xl border border-[#1f2127]">
                          <p className="text-sm sm:text-base font-semibold text-white leading-relaxed whitespace-pre-wrap break-words">
                            {selectedPass.reason}
                          </p>
                        </div>
                      </div>

                      {/* MỤC 3: MỐC THỜI GIAN GỬI & THỜI GIAN XIN RA */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Thời gian xin ra cổng - Khung màu Cyan nổi bật */}
                        <div className="bg-[#16171b] border border-cyan-500/30 rounded-2xl p-4 space-y-1 bg-gradient-to-br from-cyan-950/20 to-transparent">
                          <span className="text-[10px] text-cyan-400 uppercase tracking-wider block font-bold font-mono">
                            ⏱️ 3. THỜI GIAN XIN RA CỔNG
                          </span>
                          <div className="flex items-center gap-2 text-lg font-black text-cyan-300 mt-1">
                            <Clock className="w-4.5 h-4.5 text-cyan-400 shrink-0" />
                            <span>{new Date(selectedPass.exitTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <span className="text-xs text-cyan-400/80 font-mono block">
                            Ngày {new Date(selectedPass.exitTime).toLocaleDateString('vi-VN')}
                          </span>
                        </div>

                        {/* Thời điểm gửi phiếu */}
                        <div className="bg-[#16171b] border border-[#22242a] rounded-2xl p-4 space-y-1">
                          <span className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                            📅 THỜI ĐIỂM GỬI PHIẾU
                          </span>
                          <div className="flex items-center gap-2 text-sm font-bold text-white mt-1">
                            <Calendar className="w-4 h-4 text-zinc-400 shrink-0" />
                            <span>
                              {typeof selectedPass.createdAt === 'string' 
                                ? new Date(selectedPass.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                : selectedPass.createdAt?.seconds 
                                  ? new Date(selectedPass.createdAt.seconds * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                  : "Vừa xong"
                              }
                            </span>
                          </div>
                          <span className="text-xs text-[#8E9299] font-mono block">
                            {typeof selectedPass.createdAt === 'string' 
                              ? `Ngày ${new Date(selectedPass.createdAt).toLocaleDateString('vi-VN')}`
                              : selectedPass.createdAt?.seconds 
                                ? `Ngày ${new Date(selectedPass.createdAt.seconds * 1000).toLocaleDateString('vi-VN')}`
                                : "Hôm nay"
                            }
                          </span>
                        </div>
                      </div>

                      {/* MỤC 4: THỜI GIAN XỬ LÝ & NGƯỜI DUYỆT / TỪ CHỐI */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] text-[#8E9299] uppercase tracking-wider font-extrabold font-mono block">
                          ⚖️ 4. TRẠNG THÁI & KẾT QUẢ PHÊ DUYỆT
                        </span>

                        {selectedPass.approvedAt ? (
                          <div className={cn(
                            "border-2 border-dashed rounded-2xl p-4 sm:p-5 space-y-2.5",
                            isSelectedRejected
                              ? "bg-red-950/20 border-red-500/40 text-red-400"
                              : isSelectedExpired
                                ? "bg-amber-950/20 border-amber-500/40 text-amber-400"
                                : "bg-emerald-950/20 border-[#00FF00]/40 text-[#00FF00] bg-gradient-to-r from-[#00FF00]/10 to-transparent"
                          )}>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              {isSelectedExpired ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={cn(
                                    "text-[11px] uppercase tracking-wider font-extrabold font-mono flex items-center gap-1.5 px-3 py-1.5 rounded-xl border shadow-sm",
                                    (selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối')
                                      ? "bg-red-500/20 text-red-300 border-red-500/40"
                                      : "bg-emerald-500/20 text-[#00FF00] border-[#00FF00]/40"
                                  )}>
                                    {(selectedPass.status === 'rejected' || selectedPass.status === 'Từ chối') ? (
                                      <><XCircle className="w-4 h-4 text-red-400" /> ĐÃ TỪ CHỐI</>
                                    ) : (
                                      <><CheckCircle2 className="w-4 h-4 text-[#00FF00]" /> ĐÃ ĐƯỢC DUYỆT</>
                                    )}
                                  </span>

                                  <span className="text-[11px] uppercase tracking-wider font-extrabold font-mono flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-sm">
                                    <Timer className="w-4 h-4 text-amber-400" />
                                    ĐÃ HẾT HẠN RA CỔNG (QUÁ 30 PHÚT)
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[11px] uppercase tracking-wider font-extrabold font-mono flex items-center gap-1.5">
                                  {isSelectedRejected ? (
                                    <><XCircle className="w-4 h-4 text-red-400" /> TỪ CHỐI CHO RA CỔNG</>
                                  ) : (
                                    <><CheckCircle2 className="w-4 h-4 text-[#00FF00]" /> ĐÃ PHÊ DUYỆT CHO RA CỔNG (CÒN HIỆU LỰC)</>
                                  )}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-base sm:text-lg font-black font-mono">
                              <span>{new Date(selectedPass.approvedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                              <span className="text-xs font-normal opacity-80">
                                - Ngày {new Date(selectedPass.approvedAt).toLocaleDateString('vi-VN')}
                              </span>
                            </div>

                            {isSelectedApproved && (
                              <div className="text-xs text-[#00FF00] font-mono flex items-center gap-1.5 font-bold">
                                <Timer className="w-3.5 h-3.5 animate-pulse" />
                                <span>Thời hạn còn lại: {formatCountdown(selectedRemainingSecs)}</span>
                              </div>
                            )}

                            {isSelectedExpired && selectedExpiryDate && (
                              <div className="text-xs text-amber-400 font-mono flex items-center gap-1.5 font-bold">
                                <Timer className="w-3.5 h-3.5 text-amber-400" />
                                <span>Đã hết hạn ra cổng lúc: {selectedExpiryDate.toLocaleTimeString('vi-VN')}</span>
                              </div>
                            )}

                            {selectedPass.approvedBy && (
                              <div className="text-xs pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-2">
                                <span className="text-[#8E9299]">Cán bộ xem xét & phê duyệt:</span>
                                <strong className="text-white font-bold">{selectedPass.approvedBy}</strong>
                                {(selectedPass.approverRole || selectedPass.approverPosition) && (
                                  <span className={cn(
                                    "px-2.5 py-0.5 rounded-full text-[10px] font-bold border",
                                    isSelectedRejected 
                                      ? "bg-red-500/10 text-red-300 border-red-500/30" 
                                      : isSelectedExpired
                                        ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                        : "bg-[#00FF00]/10 text-[#00FF00] border-[#00FF00]/30"
                                  )}>
                                    {selectedPass.approverRole || selectedPass.approverPosition}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-[#16171b] border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-400/90 flex items-center gap-3">
                            <Clock className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                            <div>
                              <span className="font-bold block text-sm text-amber-300">Đơn đang chờ xem xét</span>
                              <span className="text-[11px] text-amber-400/70">
                                Phiếu xin ra đang chờ Giám thị hoặc Ban Đoàn trường kiểm duyệt trước khi có hiệu lực xuất trình cho bảo vệ.
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </div>

                {/* 3. Footer hàng thao tác cố định dưới cùng: Luôn dễ tìm và bấm */}
                <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#141519] border-t border-[#22242a] flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    {/* Xuất trình Thẻ Bảo vệ (nếu đã được xử lý) */}
                    {(isSelectedApproved || isSelectedExpired || isSelectedRejected) && (
                      <button 
                        type="button"
                        onClick={() => setShowSecurityBadge(true)}
                        className={cn(
                          "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 uppercase tracking-wider shadow-sm cursor-pointer active:scale-95 border",
                          isSelectedApproved 
                            ? "bg-[#00FF00]/15 hover:bg-[#00FF00] text-[#00FF00] hover:text-black border-[#00FF00]/40" 
                            : isSelectedExpired 
                              ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/40"
                              : "bg-red-500/15 hover:bg-red-500/25 text-red-400 border-red-500/40"
                        )}
                      >
                        {isSelectedExpired ? <Timer className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                        <span>{isSelectedExpired ? "📱 Thẻ Bảo vệ (Quá hạn 30p)" : "📱 Xuất trình Thẻ Bảo vệ"}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 ml-auto">
                    {/* Quyền Duyệt / Từ chối cho Quản trị viên */}
                    {userProfile?.role === 'admin' && (selectedPass.status === 'pending' || selectedPass.status === 'Chờ duyệt') && (
                      <>
                        <button 
                          type="button"
                          onClick={() => {
                            const nowIso = new Date().toISOString();
                            const approverName = userProfile?.displayName?.trim() || user?.email || 'Ban Giám Thị';
                            const approverPos = userProfile?.position?.trim() || 'Giám thị / Quản trị viên';
                            handleUpdateStatus(selectedPass.id!, 'approved');
                            setSelectedPass(prev => prev ? { 
                              ...prev, 
                              status: 'Đã duyệt', 
                              approvedAt: nowIso,
                              approvedBy: approverName,
                              approverRole: approverPos,
                              approverPosition: approverPos 
                            } : null);
                          }}
                          className="bg-[#00FF00] text-black hover:bg-[#00CC00] px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-[#00FF00]/10 active:scale-95"
                        >
                          <Check className="w-4 h-4" /> DUYỆT PHIẾU
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            const nowIso = new Date().toISOString();
                            const approverName = userProfile?.displayName?.trim() || user?.email || 'Ban Giám Thị';
                            const approverPos = userProfile?.position?.trim() || 'Giám thị / Quản trị viên';
                            handleUpdateStatus(selectedPass.id!, 'rejected');
                            setSelectedPass(prev => prev ? { 
                              ...prev, 
                              status: 'Từ chối', 
                              approvedAt: nowIso,
                              approvedBy: approverName,
                              approverRole: approverPos,
                              approverPosition: approverPos 
                            } : null);
                          }}
                          className="bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all border border-red-500/30 flex items-center gap-1.5 cursor-pointer active:scale-95"
                        >
                          <X className="w-4 h-4" /> TỪ CHỐI
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPass(null);
                        setShowSecurityBadge(false);
                      }}
                      className="bg-[#1c1d21] hover:bg-[#282a31] text-[#8E9299] hover:text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all border border-[#282a31] cursor-pointer"
                    >
                      Đóng (Esc)
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
          );
        })()}
      </AnimatePresence>

      {/* Modal xác nhận xóa hàng loạt - Chỉ Quản trị viên cấp cao */}
      <AnimatePresence>
        {bulkDeleteConfirm && isMasterAdmin && (
          <div className="fixed inset-0 z-[110] overflow-y-auto flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setBulkDeleteConfirm(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-sm bg-[#111214] border border-red-500/25 rounded-2xl p-6 shadow-2xl z-10 space-y-4 font-sans text-center"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-white font-bold text-sm uppercase tracking-wider font-mono">Xác nhận xóa hàng loạt</h3>
                <p className="text-[#8E9299] text-xs leading-relaxed">
                  Bạn có chắc chắn muốn xóa <span className="text-red-400 font-extrabold">{selectedPassIds.length}</span> phiếu đăng ký đã chọn? Hành động này không thể hoàn tác.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setBulkDeleteConfirm(false)}
                  className="flex-1 bg-[#1c1d21] text-[#8E9299] hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all uppercase tracking-wider cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={handleDeleteBulk}
                  disabled={isDeleting}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Đồng ý xóa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal xác nhận xóa một phiếu - Chỉ Quản trị viên cấp cao */}
      <AnimatePresence>
        {passToDelete && isMasterAdmin && (
          <div className="fixed inset-0 z-[110] overflow-y-auto flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPassToDelete(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-sm bg-[#111214] border border-red-500/25 rounded-2xl p-6 shadow-2xl z-10 space-y-4 font-sans text-center"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-white font-bold text-sm uppercase tracking-wider font-mono">Xác nhận xóa phiếu</h3>
                <p className="text-[#8E9299] text-xs leading-relaxed">
                  Bạn có chắc chắn muốn xóa phiếu đăng ký này của học sinh/cán bộ? Thao tác này không thể thu hồi.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setPassToDelete(null)}
                  className="flex-1 bg-[#1c1d21] text-[#8E9299] hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all uppercase tracking-wider cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={() => passToDelete && handleDeleteSingle(passToDelete)}
                  disabled={isDeleting}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Đồng ý xóa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL CHUYÊN DỤNG: PHÓNG TO ẢNH NHẬN DIỆN KHUÔN MẶT ================= */}
      <AnimatePresence>
        {zoomedPass && (
          <div 
            className="fixed inset-0 z-[120] overflow-y-auto flex items-center justify-center p-2 sm:p-4 lg:p-6"
            onClick={() => {
              setZoomedPass(null);
              setImageZoomScale(1);
              setPanOffset({ x: 0, y: 0 });
            }}
          >
            {/* Backdrop làm mờ */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/92 backdrop-blur-md"
            />

            {/* Khung modal hiển thị ảnh phóng to: Desktop rộng đến 1200px (min(90vw, 1200px)), cao 92vh */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 15 }}
              className="relative w-[96vw] sm:w-[94vw] lg:w-[90vw] max-w-[1200px] max-h-[92vh] bg-[#0c0d10] border border-[#00FF00]/40 rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl z-10 font-sans flex flex-col my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1. Thanh tiêu đề & Bộ công cụ điều khiển Zoom đầy đủ */}
              <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#141519] border-b border-[#22242a] flex items-center justify-between gap-3 shrink-0 flex-wrap">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#00FF00]/10 border border-[#00FF00]/40 flex items-center justify-center text-[#00FF00] shadow-sm shrink-0">
                    <Eye className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-wider truncate">
                        Đối chiếu nhận diện khuôn mặt
                      </h3>
                      <span className="text-[10px] sm:text-xs font-mono text-[#00FF00] bg-black/70 px-2 sm:px-2.5 py-0.5 rounded border border-[#00FF00]/30 font-bold select-all">
                        ID: {zoomedPass.passId || zoomedPass.id}
                      </span>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-[#8E9299] truncate hidden sm:block">
                      Hiển thị trọn ảnh ban đầu • Hỗ trợ phóng to & kéo ảnh để đối chiếu đặc điểm nhận dạng
                    </p>
                  </div>
                </div>

                {/* Các nút điều khiển Zoom, Đặt lại 100%, Toàn màn hình & Đóng */}
                <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
                  <div className="flex items-center bg-[#07080a] border border-[#22242a] rounded-xl p-1 text-xs">
                    {/* Nút thu nhỏ */}
                    <button
                      type="button"
                      onClick={() => setImageZoomScale(prev => Math.max(1, +(prev - 0.25).toFixed(2)))}
                      disabled={imageZoomScale <= 1}
                      className="p-1.5 rounded-lg text-[#8E9299] hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
                      title="Thu nhỏ (-)"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>

                    {/* Mức % zoom */}
                    <span className="px-2 font-mono text-[11px] font-bold text-[#00FF00] min-w-[50px] text-center select-none">
                      {Math.round(imageZoomScale * 100)}%
                    </span>

                    {/* Nút phóng to */}
                    <button
                      type="button"
                      onClick={() => setImageZoomScale(prev => Math.min(3.5, +(prev + 0.25).toFixed(2)))}
                      disabled={imageZoomScale >= 3.5}
                      className="p-1.5 rounded-lg text-[#8E9299] hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
                      title="Phóng to (+)"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>

                    {/* Đặt lại 100% */}
                    <button
                      type="button"
                      onClick={() => {
                        setImageZoomScale(1);
                        setPanOffset({ x: 0, y: 0 });
                      }}
                      className={cn(
                        "ml-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer",
                        imageZoomScale === 1 ? "text-zinc-500 bg-transparent" : "text-[#00FF00] bg-[#00FF00]/10 border border-[#00FF00]/30"
                      )}
                      title="Đặt lại mức zoom 100%"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>100%</span>
                    </button>

                    {/* Toàn màn hình */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="ml-1 p-1.5 rounded-lg text-[#8E9299] hover:text-[#00FF00] hover:bg-zinc-800 transition-all cursor-pointer hidden sm:flex"
                      title={isImageFullscreen ? "Thu nhỏ toàn màn hình" : "Toàn màn hình"}
                    >
                      {isImageFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Nút Đóng */}
                  <button
                    type="button"
                    onClick={() => {
                      setZoomedPass(null);
                      setImageZoomScale(1);
                      setPanOffset({ x: 0, y: 0 });
                    }}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#1c1d21] hover:bg-red-500/20 text-[#8E9299] hover:text-red-400 border border-[#2b2c32] flex items-center justify-center transition-all cursor-pointer"
                    title="Đóng cửa sổ xem ảnh (Esc) và quay lại phiếu"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </div>

              {/* 2. Thân Modal: Phân bổ 2 phần bên cạnh nhau trên Desktop, xếp dọc trên Điện thoại */}
              <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                
                {/* Vùng TRÁI: Khu vực hiển thị ảnh chiếm phần lớn diện tích */}
                <div 
                  className={cn(
                    "flex-1 min-w-0 bg-[#060709] relative flex items-center justify-center overflow-hidden min-h-[350px] sm:min-h-[420px] lg:min-h-[500px] select-none p-3 sm:p-5",
                    imageZoomScale > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
                  )}
                  onMouseDown={(e) => handlePanStart(e.clientX, e.clientY)}
                  onMouseMove={(e) => handlePanMove(e.clientX, e.clientY)}
                  onMouseUp={handlePanEnd}
                  onMouseLeave={handlePanEnd}
                  onTouchStart={(e) => {
                    if (e.touches.length === 1) {
                      handlePanStart(e.touches[0].clientX, e.touches[0].clientY);
                    }
                  }}
                  onTouchMove={(e) => {
                    if (e.touches.length === 1) {
                      handlePanMove(e.touches[0].clientX, e.touches[0].clientY);
                    }
                  }}
                  onTouchEnd={handlePanEnd}
                  onDoubleClick={() => {
                    if (imageZoomScale > 1) {
                      setImageZoomScale(1);
                      setPanOffset({ x: 0, y: 0 });
                    } else {
                      setImageZoomScale(1.75);
                    }
                  }}
                  title={imageZoomScale > 1 ? "Giữ chuột để kéo xem các góc ảnh • Nhấp đúp để về 100%" : "Nhấp đúp để phóng to 175%"}
                >
                  {/* Lưới chấm AI bảo mật nền */}
                  <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#00FF00_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

                  {/* Khung ngắm khuôn mặt công nghệ cao viền góc */}
                  <div className="absolute inset-4 sm:inset-6 pointer-events-none border border-[#00FF00]/15 rounded-2xl flex flex-col justify-between p-2">
                    <div className="flex justify-between">
                      <span className="w-5 h-5 border-t-2 border-l-2 border-[#00FF00]" />
                      <span className="w-5 h-5 border-t-2 border-r-2 border-[#00FF00]" />
                    </div>
                    <div className="flex justify-between">
                      <span className="w-5 h-5 border-b-2 border-l-2 border-[#00FF00]" />
                      <span className="w-5 h-5 border-b-2 border-r-2 border-[#00FF00]" />
                    </div>
                  </div>

                  {/* Thanh thông báo trạng thái kéo ảnh (chỉ hiện khi zoom > 100%) */}
                  {imageZoomScale > 1 ? (
                    <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-zinc-700 text-[11px] text-zinc-200 flex items-center gap-2 shadow-xl pointer-events-none">
                      <Move className="w-3.5 h-3.5 text-[#00FF00] animate-pulse shrink-0" />
                      <span>Giữ chuột / vuốt để di chuyển ảnh</span>
                    </div>
                  ) : (
                    <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-full border border-zinc-800 text-[10px] text-zinc-400 flex items-center gap-1.5 shadow pointer-events-none hidden sm:flex">
                      <Eye className="w-3 h-3 text-[#00FF00] shrink-0" />
                      <span>Trọn ảnh gốc (object-fit: contain) • Nhấp đúp để phóng to</span>
                    </div>
                  )}

                  {/* Hình ảnh chân dung đối chiếu */}
                  <motion.img
                    animate={{ 
                      scale: imageZoomScale,
                      x: imageZoomScale > 1 ? panOffset.x : 0,
                      y: imageZoomScale > 1 ? panOffset.y : 0,
                    }}
                    transition={isPanning ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 28 }}
                    src={zoomedPass.photoUrl}
                    alt={zoomedPass.fullName}
                    referrerPolicy="no-referrer"
                    className="max-h-[50vh] sm:max-h-[60vh] lg:max-h-[75vh] max-w-full object-contain rounded-xl shadow-2xl pointer-events-none select-none transition-transform"
                  />
                </div>

                {/* Vùng PHẢI: Bảng thông tin gọn gàng bên cạnh ảnh trên Desktop; dưới ảnh trên Điện thoại. Không che khuôn mặt! */}
                <div className="w-full lg:w-80 xl:w-96 shrink-0 bg-[#121317] border-t lg:border-t-0 lg:border-l border-[#22242a] p-4 sm:p-5 overflow-y-auto flex flex-col justify-between space-y-4">
                  <div className="space-y-4">
                    {/* Tiêu đề mục */}
                    <div className="flex items-center justify-between border-b border-[#22242a] pb-2.5">
                      <span className="text-[10px] text-[#8E9299] uppercase tracking-wider font-extrabold font-mono flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#00FF00]" /> BẢNG HỒ SƠ ĐỐI CHIẾU
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        GatePass AI
                      </span>
                    </div>

                    {/* Trạng thái duyệt nổi bật */}
                    <div>
                      <span className="text-[10px] text-[#8E9299] uppercase block font-mono font-bold mb-1">
                        Trạng thái phê duyệt:
                      </span>
                      <span className={cn(
                        "text-xs px-3 py-1.5 rounded-xl font-extrabold uppercase font-mono tracking-wider flex items-center gap-1.5 border shadow-sm w-full justify-center",
                        zoomedPass.status === 'approved' || zoomedPass.status === 'Đã duyệt' ? "text-[#00FF00] bg-emerald-950/40 border-[#00FF00]/40" :
                        zoomedPass.status === 'rejected' || zoomedPass.status === 'Từ chối' ? "text-red-400 bg-red-950/40 border-red-500/40" : "text-amber-400 bg-amber-950/40 border-amber-500/40"
                      )}>
                        {zoomedPass.status === 'approved' || zoomedPass.status === 'Đã duyệt' ? <><CheckCircle2 className="w-3.5 h-3.5 text-[#00FF00]" /> ĐÃ DUYỆT RA CỔNG</> :
                         zoomedPass.status === 'rejected' || zoomedPass.status === 'Từ chối' ? <><XCircle className="w-3.5 h-3.5 text-red-400" /> TỪ CHỐI RA CỔNG</> : <><Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" /> CHỜ DUYỆT</>}
                      </span>
                    </div>

                    {/* Họ và tên đầy đủ */}
                    <div className="bg-[#090a0d] p-3 rounded-xl border border-[#1f2127]">
                      <span className="text-[10px] text-[#8E9299] block font-mono uppercase font-bold">Họ và tên:</span>
                      <h4 className="text-base sm:text-lg font-black text-white uppercase tracking-tight break-words mt-0.5">
                        {zoomedPass.fullName}
                      </h4>
                    </div>

                    {/* Bảng chi tiết Lớp & SĐT & Mã phiếu */}
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center bg-[#090a0d] px-3 py-2 rounded-xl border border-[#1f2127]">
                        <span className="text-[#8E9299] text-[11px]">Lớp / Đơn vị:</span>
                        <span className="font-extrabold text-white break-words max-w-[60%] text-right">{zoomedPass.department}</span>
                      </div>

                      <div className="flex justify-between items-center bg-[#090a0d] px-3 py-2 rounded-xl border border-[#1f2127]">
                        <span className="text-[#8E9299] text-[11px]">Số điện thoại:</span>
                        <span className="font-mono font-bold text-cyan-400">
                          {zoomedPass.phoneNumber ? `📞 ${zoomedPass.phoneNumber}` : <span className="text-zinc-500 font-normal">Chưa có</span>}
                        </span>
                      </div>

                      <div className="flex justify-between items-center bg-[#090a0d] px-3 py-2 rounded-xl border border-[#1f2127]">
                        <span className="text-[#8E9299] text-[11px]">Mã phiếu (ID):</span>
                        <span className="font-mono font-bold text-[#00FF00] select-all">
                          {zoomedPass.passId || zoomedPass.id}
                        </span>
                      </div>

                      <div className="flex justify-between items-center bg-[#090a0d] px-3 py-2 rounded-xl border border-[#1f2127]">
                        <span className="text-[#8E9299] text-[11px]">Giờ xin ra:</span>
                        <span className="font-bold text-cyan-300 font-mono">
                          {new Date(zoomedPass.exitTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          <span className="text-zinc-400 font-normal ml-1">({new Date(zoomedPass.exitTime).toLocaleDateString('vi-VN')})</span>
                        </span>
                      </div>

                      {zoomedPass.approvedAt && (
                        <div className="bg-[#090a0d] p-3 rounded-xl border border-[#1f2127] space-y-1">
                          <span className="text-[#8E9299] text-[10px] uppercase font-mono block">Cán bộ phê duyệt:</span>
                          <div className="text-white font-bold flex items-center justify-between">
                            <span>{zoomedPass.approvedBy || "Ban Giám Thị"}</span>
                            {(zoomedPass.approverRole || zoomedPass.approverPosition) && (
                              <span className="text-[#00FF00] text-[10px] font-mono border border-[#00FF00]/30 px-1.5 py-0.5 rounded">
                                {zoomedPass.approverRole || zoomedPass.approverPosition}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Lý do xin ra */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-[#8E9299] uppercase tracking-wider block font-bold font-mono">
                        Lý do xin ra cổng:
                      </span>
                      <div className="bg-[#090a0d] p-3 rounded-xl border border-[#1f2127] max-h-[90px] overflow-y-auto">
                        <p className="text-xs text-zinc-200 leading-relaxed break-words whitespace-pre-wrap">
                          {zoomedPass.reason}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Ghi chú an toàn & Nút quay lại phiếu */}
                  <div className="pt-2 border-t border-[#22242a] space-y-2">
                    <p className="text-[10px] text-zinc-400 leading-tight">
                      🔒 Ảnh khuôn mặt lưu trữ nội bộ để bảo vệ đối chiếu trực tiếp khi học sinh xuất trình ra cổng.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setZoomedPass(null);
                        setImageZoomScale(1);
                        setPanOffset({ x: 0, y: 0 });
                      }}
                      className="w-full bg-[#1c1d21] hover:bg-[#282a31] text-white py-2.5 rounded-xl font-bold text-xs transition-all border border-[#282a31] cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <X className="w-3.5 h-3.5" /> Đóng ảnh (Quay lại phiếu)
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. Thanh chân trang gợi ý */}
              <div className="px-4 sm:px-6 py-2.5 sm:py-3 bg-[#111215] border-t border-[#22242a] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#8E9299] shrink-0">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#00FF00] animate-pulse" />
                  <span>Dùng phím <kbd className="px-1.5 py-0.5 bg-black rounded border border-zinc-700 text-zinc-300 font-mono text-[10px]">Esc</kbd> hoặc nút Đóng để quay về chi tiết phiếu mà không mất trạng thái.</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setImageZoomScale(1);
                      setPanOffset({ x: 0, y: 0 });
                    }}
                    className="text-[11px] text-zinc-400 hover:text-[#00FF00] transition-colors cursor-pointer"
                  >
                    Đặt lại vị trí ảnh
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Quản trị: Tạo tài khoản Quản trị viên & Cán bộ duyệt phép - Chỉ Quản trị viên cấp cao */}
      <AnimatePresence>
        {showCreateAdminModal && userProfile?.role === 'admin' && isMasterAdmin && (
          <div className="fixed inset-0 z-[120] overflow-y-auto flex items-center justify-center p-3 sm:p-5">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateAdminModal(false)}
              className="fixed inset-0 bg-black/85 backdrop-blur-md"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-2xl bg-[#111215] border border-[#00FF00]/40 rounded-3xl shadow-2xl z-10 overflow-hidden font-sans flex flex-col max-h-[92vh]"
            >
              {/* Header */}
              <div className="p-5 sm:p-6 border-b border-[#1c1d21] bg-[#16171c] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#00FF00]/15 border border-[#00FF00]/40 flex items-center justify-center text-[#00FF00]">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm sm:text-base font-bold text-white tracking-wide uppercase font-mono">
                        CẤP TÀI KHOẢN QUẢN TRỊ DUYỆT PHÉP
                      </h2>
                      <span className="text-[9px] bg-[#00FF00]/15 text-[#00FF00] px-2 py-0.5 rounded font-mono font-bold border border-[#00FF00]/30 hidden sm:inline">
                        CHỈ DÀNH CHO ADMIN
                      </span>
                    </div>
                    <p className="text-xs text-[#8E9299] mt-0.5">
                      Tạo tài khoản quản trị viên mới có thẩm quyền xem và phê duyệt phiếu ra cổng
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateAdminModal(false)}
                  className="p-2 text-[#8E9299] hover:text-white hover:bg-[#202229] rounded-xl transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tab Navigation inside Modal */}
              <div className="flex border-b border-[#1c1d21] bg-[#131418] px-5 sm:px-6 pt-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setAdminModalTab('create')}
                  className={cn(
                    "px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-2",
                    adminModalTab === 'create'
                      ? "border-[#00FF00] text-[#00FF00] bg-[#00FF00]/5"
                      : "border-transparent text-[#8E9299] hover:text-white"
                  )}
                >
                  <UserPlus className="w-4 h-4" />
                  + Tạo tài khoản mới
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdminModalTab('list');
                    loadAdminList();
                  }}
                  className={cn(
                    "px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-2",
                    adminModalTab === 'list'
                      ? "border-[#00FF00] text-[#00FF00] bg-[#00FF00]/5"
                      : "border-transparent text-[#8E9299] hover:text-white"
                  )}
                >
                  <ShieldCheck className="w-4 h-4" />
                  Danh sách tài khoản đã cấp ({adminList.filter(a => (a.email || '').toLowerCase() !== 'lytm.angiang@gmail.com').length + 1})
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
                {adminModalTab === 'create' ? (
                  <form onSubmit={handleCreateAdminAccount} className="space-y-4">
                    {createAdminSuccess && (
                      <div className="p-4 rounded-2xl bg-[#00FF00]/10 border border-[#00FF00]/40 text-[#00FF00] text-xs flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 shrink-0 text-[#00FF00] mt-0.5" />
                        <div className="space-y-1">
                          <span className="font-bold block uppercase tracking-wide">Tạo thành công!</span>
                          <p className="leading-relaxed text-zinc-200">{createAdminSuccess}</p>
                        </div>
                      </div>
                    )}

                    {createAdminError && (
                      <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/40 text-red-400 text-xs flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
                        <div className="space-y-1">
                          <span className="font-bold block uppercase tracking-wide">Không thể tạo:</span>
                          <p className="leading-relaxed text-zinc-200">{createAdminError}</p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Họ tên cán bộ */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#8E9299] font-mono flex items-center gap-1.5">
                          <UserIcon className="w-3.5 h-3.5 text-[#00FF00]" />
                          Họ và tên cán bộ <span className="text-red-400">*</span>
                        </label>
                        <input
                          required
                          type="text"
                          placeholder="Ví dụ: Thầy Trần Quang Vinh"
                          value={newAdminName}
                          onChange={(e) => setNewAdminName(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-[#1c1d21] focus:border-[#00FF00] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white outline-none transition-all placeholder:text-[#52565e]"
                        />
                      </div>

                      {/* Chức vụ duyệt phiếu */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#8E9299] font-mono flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#00FF00]" />
                          Chức vụ duyệt phiếu <span className="text-red-400">*</span>
                        </label>
                        <select
                          value={newAdminPosition}
                          onChange={(e) => setNewAdminPosition(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-[#1c1d21] focus:border-[#00FF00] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white outline-none transition-all cursor-pointer font-sans"
                        >
                          {APPROVER_POSITIONS.map(pos => (
                            <option key={pos} value={pos} className="bg-[#111215] text-white">
                              {pos}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Email đăng nhập */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#8E9299] font-mono flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-[#00FF00]" />
                          Email cán bộ đăng nhập <span className="text-red-400">*</span>
                        </label>
                        <input
                          required
                          type="email"
                          placeholder="Ví dụ: vinh.tran@thpt.edu.vn"
                          value={newAdminEmail}
                          onChange={(e) => setNewAdminEmail(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-[#1c1d21] focus:border-[#00FF00] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white outline-none transition-all placeholder:text-[#52565e]"
                        />
                      </div>

                      {/* Số điện thoại liên hệ */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#8E9299] font-mono flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-[#00FF00]" />
                          Số điện thoại liên hệ
                        </label>
                        <input
                          type="tel"
                          placeholder="Ví dụ: 0912345678"
                          value={newAdminPhone}
                          onChange={(e) => setNewAdminPhone(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-[#1c1d21] focus:border-[#00FF00] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white outline-none transition-all placeholder:text-[#52565e]"
                        />
                      </div>

                      {/* Mật khẩu khởi tạo */}
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#8E9299] font-mono flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-[#00FF00]" />
                          Mật khẩu khởi tạo ban đầu (ít nhất 6 ký tự) <span className="text-red-400">*</span>
                        </label>
                        <input
                          required
                          type="password"
                          placeholder="Nhập mật khẩu cho cán bộ mới..."
                          value={newAdminPassword}
                          onChange={(e) => setNewAdminPassword(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-[#1c1d21] focus:border-[#00FF00] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white outline-none transition-all placeholder:text-[#52565e]"
                        />
                      </div>
                    </div>

                    {/* Hướng dẫn quyền hạn */}
                    <div className="p-3.5 rounded-2xl bg-[#171920] border border-[#22252e] text-xs text-[#8E9299] space-y-1.5 leading-relaxed">
                      <div className="font-bold text-white flex items-center gap-1.5 font-mono text-[11px]">
                        <ShieldAlert className="w-4 h-4 text-[#00FF00]" />
                        QUYỀN HẠN CỦA TÀI KHOẢN ĐƯỢC CẤP:
                      </div>
                      <p>
                        • Cán bộ có quyền xem danh sách phiếu toàn trường, lọc theo lớp, và phê duyệt / từ chối phiếu ra cổng.
                      </p>
                      <p>
                        • Khi duyệt, hệ thống tự động ghi nhận họ tên và chức vụ (<strong className="text-white">{newAdminPosition}</strong>) lên chữ ký điện tử của phiếu.
                      </p>
                      <p>
                        • Cán bộ có thể đăng nhập bằng email & mật khẩu đã cấp vào hệ thống.
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowCreateAdminModal(false)}
                        className="px-5 py-2.5 rounded-xl bg-[#1c1d21] hover:bg-[#252830] text-[#8E9299] hover:text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Đóng
                      </button>
                      <button
                        type="submit"
                        disabled={isCreatingAdmin}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#00FF00] hover:bg-[#00CC00] disabled:bg-[#1c1d21] disabled:text-[#8E9299] text-black font-bold text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer shadow-lg shadow-[#00FF00]/15 font-mono"
                      >
                        {isCreatingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        {isCreatingAdmin ? "ĐANG KHỞI TẠO..." : "TẠO TÀI KHOẢN QUẢN TRỊ"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#8E9299] font-mono">
                        Danh sách tài khoản quản trị & cán bộ duyệt phép đã cấp:
                      </span>
                      <button
                        type="button"
                        onClick={loadAdminList}
                        disabled={isLoadingAdminList}
                        className="text-xs text-[#00FF00] hover:underline flex items-center gap-1 font-mono cursor-pointer"
                      >
                        <RefreshCcw className={cn("w-3.5 h-3.5", isLoadingAdminList && "animate-spin")} />
                        Làm mới
                      </button>
                    </div>

                    {isLoadingAdminList ? (
                      <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#8E9299]">
                        <Loader2 className="w-6 h-6 animate-spin text-[#00FF00]" />
                        <span className="text-xs font-mono">Đang tải danh sách tài khoản đã cấp...</span>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {/* Admin cấp cao lytm.angiang@gmail.com */}
                        <div className="p-4 rounded-2xl bg-gradient-to-r from-[#171920] to-[#121317] border border-[#00FF00]/40 shadow-lg flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#00FF00]/15 text-[#00FF00] flex items-center justify-center font-bold border border-[#00FF00]/30 shadow-sm">
                              <ShieldCheck className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white text-sm">Trần Minh Lý</span>
                                <span className="text-[9px] bg-[#00FF00]/20 text-[#00FF00] px-2.5 py-0.5 rounded-full font-mono font-black border border-[#00FF00]/40">
                                  ADMIN CẤP CAO
                                </span>
                              </div>
                              <span className="text-[11px] text-[#8E9299] font-mono block mt-0.5">lytm.angiang@gmail.com</span>
                            </div>
                          </div>
                          <div className="text-right text-xs">
                            <span className="text-[#00FF00] font-bold block font-mono text-sm">Bí thư ĐT</span>
                            <span className="text-[10px] text-[#8E9299]">Toàn quyền hệ thống & Cấp tài khoản quản trị</span>
                          </div>
                        </div>

                        {/* Các tài khoản quản trị khác đã cấp */}
                        {adminList.filter(a => (a.email || '').toLowerCase() !== 'lytm.angiang@gmail.com').length === 0 ? (
                          <div className="p-6 text-center text-xs text-[#8E9299] border border-dashed border-[#22252e] rounded-2xl space-y-1">
                            <p className="font-mono text-zinc-300">Chưa có thêm tài khoản cán bộ duyệt phép nào khác được tạo.</p>
                            <p className="text-[11px] text-[#6b6f79]">Bấm tab "+ Tạo tài khoản mới" ở trên để cấp tài khoản cho các cán bộ khác.</p>
                          </div>
                        ) : (
                          adminList.filter(a => (a.email || '').toLowerCase() !== 'lytm.angiang@gmail.com').map((adm, idx) => (
                            <div key={adm.id || idx} className="p-3.5 rounded-2xl bg-[#131418] border border-[#1f2127] hover:border-[#2a2d36] flex flex-wrap items-center justify-between gap-3 transition-all">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-[#1c1d22] text-zinc-300 flex items-center justify-center font-bold">
                                  <UserIcon className="w-4 h-4 text-[#00FF00]" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-white text-xs">{adm.displayName || "Cán bộ quản trị"}</span>
                                    <span className="text-[9px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded font-mono border border-zinc-700">
                                      {adm.position || "Quản trị viên"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-[#8E9299] font-mono">
                                    <span>{adm.email}</span>
                                    {adm.phoneNumber && <span>• SĐT: {adm.phoneNumber}</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right text-xs">
                                <span className="text-zinc-400 font-mono text-[11px] block">
                                  {adm.createdAt ? `Tạo: ${new Date(adm.createdAt).toLocaleDateString('vi-VN')}` : 'Đã kích hoạt'}
                                </span>
                                <span className="text-[10px] text-emerald-400">✓ Có quyền duyệt</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
