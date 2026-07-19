import React from 'react';
import { ArrowLeft, Book, Shield, CheckCircle, ExternalLink, AlertTriangle } from 'lucide-react';
import { Card, Alert } from '../src/design/ui';

interface DocumentationViewProps {
  onBack: () => void;
}

export const DocumentationView: React.FC<DocumentationViewProps> = ({ onBack }) => (
  <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
    <button
      onClick={onBack}
      className="group flex items-center text-neutral-400 hover:text-volt-text transition-colors mb-8 text-sm font-medium rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
    >
      <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
      Back to Integrations
    </button>

    <div className="max-w-4xl mx-auto space-y-12 pb-12">

      {/* Header */}
      <div className="border-b border-white/10 pb-8">
        <h1 className="text-3xl font-semibold text-white mb-4 flex items-center">
          <Book className="w-8 h-8 mr-3 text-volt-text" />
          Integration Documentation
        </h1>
        <p className="text-lg text-neutral-400 max-w-2xl leading-relaxed">
          Learn how to connect your CRM, communication tools, and data sources to YSX Flow to enable seamless context syncing and automated follow-ups.
        </p>
      </div>

      {/* General Requirements */}
      <Alert variant="info" title="Security & Permissions">
        <p className="mb-4 leading-relaxed">
          YSX Flow uses OAuth 2.0 for all integrations. We never store your passwords.
          We require <span className="font-mono text-xs bg-white/[0.06] px-1 py-0.5 rounded">read/write</span> access
          to Contacts and Deals to personalize emails and log activity.
        </p>
        <div className="flex gap-4 text-sm">
           <a href="#" className="flex items-center text-volt-text hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir">
             <ExternalLink className="w-3 h-3 mr-1" /> Privacy Policy
           </a>
           <a href="#" className="flex items-center text-volt-text hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir">
             <ExternalLink className="w-3 h-3 mr-1" /> Data Handling
           </a>
        </div>
      </Alert>

      {/* Guides Grid */}
      <div className="grid gap-8">

        {/* Zoho CRM */}
        <Card padding="none" className="overflow-hidden">
          <div className="p-6 border-b border-white/10 bg-white/[0.02]">
             <h2 className="text-xl font-semibold text-white flex items-center">
               <div className="w-8 h-8 bg-[#e32933] rounded-lg flex items-center justify-center text-white text-xs mr-3 font-bold">ZO</div>
               Zoho CRM
             </h2>
          </div>
          <div className="p-6 space-y-6">
             <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-neutral-200 mb-2">Prerequisites</h4>
                  <ul className="space-y-2 text-sm text-neutral-400">
                    <li className="flex items-start"><CheckCircle className="w-4 h-4 mr-2 text-green-500 mt-0.5" /> Admin account access</li>
                    <li className="flex items-start"><CheckCircle className="w-4 h-4 mr-2 text-green-500 mt-0.5" /> API Access enabled in CRM settings</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-neutral-200 mb-2">What Syncs?</h4>
                  <ul className="space-y-2 text-sm text-neutral-400">
                    <li className="flex items-center"><div className="w-1.5 h-1.5 bg-neutral-500 rounded-full mr-2" /> Leads & Contacts (Bi-directional)</li>
                    <li className="flex items-center"><div className="w-1.5 h-1.5 bg-neutral-500 rounded-full mr-2" /> Deal Stages & Values</li>
                    <li className="flex items-center"><div className="w-1.5 h-1.5 bg-neutral-500 rounded-full mr-2" /> Email Activity Logging</li>
                  </ul>
                </div>
             </div>

             <div className="border-t border-white/10 pt-6">
               <h4 className="font-semibold text-neutral-200 mb-4">Connection Steps</h4>
               <ol className="space-y-4">
                 <li className="flex">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-volt/15 text-volt-text flex items-center justify-center text-xs font-bold mr-3 mt-0.5">1</span>
                    <div className="text-sm text-neutral-400">
                       Click the <span className="font-semibold text-neutral-200">Connect</span> button in the Integrations tab.
                    </div>
                 </li>
                 <li className="flex">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-volt/15 text-volt-text flex items-center justify-center text-xs font-bold mr-3 mt-0.5">2</span>
                    <div className="text-sm text-neutral-400">
                       A pop-up will appear asking you to log in to your Zoho Account. Ensure you select the correct organization if you belong to multiple.
                    </div>
                 </li>
                 <li className="flex">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-volt/15 text-volt-text flex items-center justify-center text-xs font-bold mr-3 mt-0.5">3</span>
                    <div className="text-sm text-neutral-400">
                       Click <span className="font-semibold text-neutral-200">Accept</span> to authorize YSX Flow to access your CRM data.
                    </div>
                 </li>
               </ol>
             </div>
          </div>
        </Card>

        {/* HubSpot */}
        <Card padding="none" className="overflow-hidden">
          <div className="p-6 border-b border-white/10 bg-white/[0.02]">
             <h2 className="text-xl font-semibold text-white flex items-center">
               <div className="w-8 h-8 bg-[#ff7a59] rounded-lg flex items-center justify-center text-white text-xs mr-3 font-bold">HU</div>
               HubSpot
             </h2>
          </div>
          <div className="p-6">
             <Alert variant="warning" className="mb-6">
                HubSpot tracking pixels are automatically embedded in emails sent via YSX Flow once connected.
                You do not need to manually install the tracking code.
             </Alert>
             <p className="text-sm text-neutral-400 mb-4">
               Connecting HubSpot allows you to automatically log every follow-up sent from this dashboard directly into the contact's timeline in HubSpot.
             </p>
             <div className="text-sm text-neutral-400">
               <span className="font-semibold text-neutral-200">Note:</span> If a contact does not exist in HubSpot, YSX Flow can optionally create it based on the email recipient data.
             </div>
          </div>
        </Card>

        {/* Salesforce */}
        <Card padding="none" className="overflow-hidden">
          <div className="p-6 border-b border-white/10 bg-white/[0.02]">
             <h2 className="text-xl font-semibold text-white flex items-center">
               <div className="w-8 h-8 bg-[#00a1e0] rounded-lg flex items-center justify-center text-white text-xs mr-3 font-bold">SA</div>
               Salesforce
             </h2>
          </div>
          <div className="p-6">
             <p className="text-sm text-neutral-400 mb-4">
               Requires Enterprise Edition, Unlimited Edition, or Developer Edition. Professional Edition requires the API add-on.
             </p>
             <h4 className="font-semibold text-neutral-200 mb-3 text-sm">Setup Instructions</h4>
             <div className="bg-white/[0.03] p-4 rounded-lg border border-white/10 font-mono text-xs text-neutral-400 overflow-x-auto">
                1. Log in to Salesforce.<br/>
                2. Navigate to Setup {'>'} Apps {'>'} App Manager.<br/>
                3. Create a New Connected App named "YSX Flow".<br/>
                4. Enable OAuth Settings and add "Full Access" scope.<br/>
                5. Copy the Consumer Key and Secret into the API settings here.
             </div>
          </div>
        </Card>

      </div>
    </div>
  </div>
);
