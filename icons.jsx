// Inline SVG icon set (Lucide-style strokes). Keep it lightweight; no external lib.
const Icon = ({ d, size = 18, stroke = 'currentColor', fill = 'none', children, ...rest }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
       fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {d ? <path d={d}></path> : children}
  </svg>
);

const I = {
  Map: (p) => <Icon {...p}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></Icon>,
  Home: (p) => <Icon {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a1 1 0 0 1-1-1v-6h-4v6a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z"></path></Icon>,
  Plus: (p) => <Icon {...p} d="M12 5v14M5 12h14" />,
  Activity: (p) => <Icon {...p} d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  Settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></Icon>,
  ChartBar: (p) => <Icon {...p}><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></Icon>,
  Menu: (p) => <Icon {...p} d="M3 6h18M3 12h18M3 18h18" />,
  X: (p) => <Icon {...p} d="M18 6L6 18M6 6l12 12" />,
  ArrowRight: (p) => <Icon {...p} d="M5 12h14M13 5l7 7-7 7" />,
  ArrowLeft: (p) => <Icon {...p} d="M19 12H5M12 19l-7-7 7-7" />,
  ChevronRight: (p) => <Icon {...p} d="M9 18l6-6-6-6" />,
  ChevronDown: (p) => <Icon {...p} d="M6 9l6 6 6-6" />,
  Walk: (p) => <Icon {...p}><circle cx="13" cy="4" r="2"></circle><path d="M4 22l5-9 4 3 3 6"></path><path d="M9 13L7 9l6-2 4 4 4 1"></path></Icon>,
  Car: (p) => <Icon {...p}><path d="M5 17h14M3 17l2-7h14l2 7M5 17v3M19 17v3M7 13h10"></path><circle cx="7" cy="17" r="1.5" fill="currentColor"></circle><circle cx="17" cy="17" r="1.5" fill="currentColor"></circle></Icon>,
  Clock: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 16 14"></polyline></Icon>,
  PinDrop: (p) => <Icon {...p}><path d="M12 22s7-7.16 7-12a7 7 0 1 0-14 0c0 4.84 7 12 7 12z"></path><circle cx="12" cy="10" r="2.5"></circle></Icon>,
  Route: (p) => <Icon {...p}><circle cx="6" cy="19" r="3"></circle><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"></path><circle cx="18" cy="5" r="3"></circle></Icon>,
  Upload: (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></Icon>,
  Download: (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></Icon>,
  Search: (p) => <Icon {...p}><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></Icon>,
  Trash: (p) => <Icon {...p}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></Icon>,
  Eye: (p) => <Icon {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></Icon>,
  Check: (p) => <Icon {...p} d="M20 6L9 17l-5-5" />,
  CheckCircle: (p) => <Icon {...p}><path d="M22 11.1V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></Icon>,
  AlertTriangle: (p) => <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><circle cx="12" cy="17" r="0.6" fill="currentColor"></circle></Icon>,
  Info: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="16" x2="12" y2="12"></line><circle cx="12" cy="8" r="0.6" fill="currentColor"></circle></Icon>,
  Mail: (p) => <Icon {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></Icon>,
  Lock: (p) => <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></Icon>,
  User: (p) => <Icon {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></Icon>,
  LogOut: (p) => <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></Icon>,
  Play: (p) => <Icon {...p}><polygon points="5 3 19 12 5 21" fill="currentColor"></polygon></Icon>,
  Pause: (p) => <Icon {...p}><rect x="6" y="4" width="4" height="16" fill="currentColor"></rect><rect x="14" y="4" width="4" height="16" fill="currentColor"></rect></Icon>,
  TrendUp: (p) => <Icon {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></Icon>,
  Zap: (p) => <Icon {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></Icon>,
  Layers: (p) => <Icon {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></Icon>,
  Shield: (p) => <Icon {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></Icon>,
  Globe: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"></circle><line x1="3" y1="12" x2="21" y2="12"></line><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></Icon>,
  Smartphone: (p) => <Icon {...p}><rect x="6" y="2" width="12" height="20" rx="2"></rect><line x1="12" y1="18" x2="12" y2="18.01"></line></Icon>,
  File: (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></Icon>,
  Copy: (p) => <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></Icon>,
  Github: (p) => <Icon {...p}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></Icon>,
  Sparkles: (p) => <Icon {...p}><path d="M12 3l1.9 5.7L20 10l-6.1 1.3L12 17l-1.9-5.7L4 10l6.1-1.3z"></path><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"></path></Icon>,
  Filter: (p) => <Icon {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></Icon>,
  Refresh: (p) => <Icon {...p}><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></Icon>,
};

window.I = I;
