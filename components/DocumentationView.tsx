import React from 'react';
import { ArrowLeft, Book, Shield, Key, CheckCircle, AlertCircle, ExternalLink, AlertTriangle } from 'lucide-react';

interface DocumentationViewProps {
  onBack: () => void;
}

export const DocumentationView: React.FC<DocumentationViewProps> = ({ onBack }) => (
  <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
    <button 
      onClick={onBack}
      className="group flex items-center text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors mb-8 text-sm font-medium"
    >
      <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" /> 
      Back to Integrations
    </button>

    <div className="max-w-4xl mx-auto space-y-12 pb-12">
      
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4 flex items-center">
          <Book className="w-8 h-8 mr-3 text-brand-600 dark:text-brand-400" />
          Integration Documentation
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
          Learn how to connect your CRM, communication tools, and data sources to YSX Flow to enable seamless context syncing and automated follow-ups.
        </p>
      </div>

      {/* General Requirements */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300 mb-3 flex items-center">
          <Shield className="w-5 h-5 mr-2" />
          Security & Permissions
        </h3>
        <p className="text-sm text-blue-800 dark:text-blue-400 mb-4 leading-relaxed">
          YSX Flow uses OAuth 2.0 for all integrations. We never store your passwords. 
          We require <span className="font-mono text-xs bg-blue-100 dark:bg-blue-900/40 px-1 py-0.5 rounded">read/write</span> access 
          to Contacts and Deals to personalize emails and log activity.
        </p>
        <div className="flex gap-4 text-sm">
           <a href="#" className="flex items-center text-blue-700 dark:text-blue-400 hover:underline">
             <ExternalLink className="w-3 h-3 mr-1" /> Privacy Policy
           </a>
           <a href="#" className="flex items-center text-blue-700 dark:text-blue-400 hover:underline">
             <ExternalLink className="w-3 h-3 mr-1" /> Data Handling
           </a>
        </div>
      </div>

      {/* Guides Grid */}
      <div className="grid gap-8">
        
        {/* Zoho CRM */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
             <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
               <div className="w-8 h-8 bg-[#e32933] rounded-lg flex items-center justify-center text-white text-xs mr-3 font-bold">ZO</div>
               Zoho CRM
             </h2>
          </div>
          <div className="p-6 space-y-6">
             <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Prerequisites</h4>
                  <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li className="flex items-start"><CheckCircle className="w-4 h-4 mr-2 text-green-500 mt-0.5" /> Admin account access</li>
                    <li className="flex items-start"><CheckCircle className="w-4 h-4 mr-2 text-green-500 mt-0.5" /> API Access enabled in CRM settings</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">What Syncs?</h4>
                  <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li className="flex items-center"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full mr-2" /> Leads & Contacts (Bi-directional)</li>
                    <li className="flex items-center"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full mr-2" /> Deal Stages & Values</li>
                    <li className="flex items-center"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full mr-2" /> Email Activity Logging</li>
                  </ul>
                </div>
             </div>
             
             <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
               <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-4">Connection Steps</h4>
               <ol className="space-y-4">
                 <li className="flex">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 flex items-center justify-center text-xs font-bold mr-3 mt-0.5">1</span>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                       Click the <span className="font-bold text-slate-800 dark:text-slate-300">Connect</span> button in the Integrations tab.
                    </div>
                 </li>
                 <li className="flex">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 flex items-center justify-center text-xs font-bold mr-3 mt-0.5">2</span>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                       A pop-up will appear asking you to log in to your Zoho Account. Ensure you select the correct organization if you belong to multiple.
                    </div>
                 </li>
                 <li className="flex">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 flex items-center justify-center text-xs font-bold mr-3 mt-0.5">3</span>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                       Click <span className="font-bold text-slate-800 dark:text-slate-300">Accept</span> to authorize YSX Flow to access your CRM data.
                    </div>
                 </li>
               </ol>
             </div>
          </div>
        </section>

        {/* HubSpot */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
             <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
               <div className="w-8 h-8 bg-[#ff7a59] rounded-lg flex items-center justify-center text-white text-xs mr-3 font-bold">HU</div>
               HubSpot
             </h2>
          </div>
          <div className="p-6">
             <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-lg p-4 mb-6 flex items-start">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 mr-3 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-400">
                  HubSpot tracking pixels are automatically embedded in emails sent via YSX Flow once connected. 
                  You do not need to manually install the tracking code.
                </p>
             </div>
             <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
               Connecting HubSpot allows you to automatically log every follow-up sent from this dashboard directly into the contact's timeline in HubSpot.
             </p>
             <div className="text-sm text-slate-600 dark:text-slate-400">
               <span className="font-bold text-slate-800 dark:text-slate-200">Note:</span> If a contact does not exist in HubSpot, YSX Flow can optionally create it based on the email recipient data.
             </div>
          </div>
        </section>

        {/* Salesforce */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
             <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
               <div className="w-8 h-8 bg-[#00a1e0] rounded-lg flex items-center justify-center text-white text-xs mr-3 font-bold">SA</div>
               Salesforce
             </h2>
          </div>
          <div className="p-6">
             <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
               Requires Enterprise Edition, Unlimited Edition, or Developer Edition. Professional Edition requires the API add-on.
             </p>
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-3 text-sm">Setup Instructions</h4>
             <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-600 dark:text-slate-400 overflow-x-auto">
                1. Log in to Salesforce.<br/>
                2. Navigate to Setup {'>'} Apps {'>'} App Manager.<br/>
                3. Create a New Connected App named "YSX Flow".<br/>
                4. Enable OAuth Settings and add "Full Access" scope.<br/>
                5. Copy the Consumer Key and Secret into the API settings here.
             </div>
          </div>
        </section>

      </div>
    </div>
  </div>
);