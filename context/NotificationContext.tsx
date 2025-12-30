
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

type NotificationType = 'SUCCESS' | 'ERROR';

interface Notification {
  type: NotificationType;
  message: string;
}

interface NotificationContextType {
  showToast: (type: NotificationType, message: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notification, setNotification] = useState<Notification | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const showToast = (type: NotificationType, message: string) => {
    setNotification({ type, message });
  };

  return (
    <NotificationContext.Provider value={{ showToast }}>
      {children}
      {notification && (
        <div className="fixed top-4 right-4 z-[200] animate-in slide-in-from-top-4 fade-in duration-300">
           <div className={`flex items-center p-4 rounded-xl shadow-2xl border ${
             notification.type === 'SUCCESS' 
               ? 'bg-white dark:bg-slate-800 border-green-100 dark:border-green-900/50 text-slate-800 dark:text-white' 
               : 'bg-white dark:bg-slate-800 border-red-100 dark:border-red-900/50 text-slate-800 dark:text-white'
           }`}>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
               notification.type === 'SUCCESS' 
                 ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' 
                 : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
             }`}>
                {notification.type === 'SUCCESS' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
             </div>
             <div>
               <h4 className={`text-sm font-bold ${notification.type === 'SUCCESS' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                 {notification.type === 'SUCCESS' ? 'Success' : 'Error'}
               </h4>
               <p className="text-xs text-slate-500 dark:text-slate-400">{notification.message}</p>
             </div>
             <button onClick={() => setNotification(null)} className="ml-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-4 h-4" />
             </button>
           </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
