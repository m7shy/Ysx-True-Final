
import React, { useState } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { Campaign } from '../types';
import { Search, Plus, Download, MoreVertical, Play, Pause, Trash2, Copy, FileText, Share2, Edit3, ChevronDown, ArrowRight, BarChart3 } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

interface CampaignsListViewProps {
  onNewCampaign: () => void;
  onSelectCampaign: (id: string) => void;
}

export const CampaignsListView: React.FC<CampaignsListViewProps> = ({ 
  onNewCampaign,
  onSelectCampaign
}) => {
  const { campaigns, deleteCampaign, toggleCampaignStatus, duplicateCampaign, renameCampaign } = useCampaigns();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All statuses');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  // Modal State
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'All statuses' || c.status === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
      case 'PAUSED': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
      case 'COMPLETED': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
      case 'DRAFT': return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
      case 'SCHEDULED': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
      default: return 'bg-slate-600 text-slate-300';
    }
  };

  const handleRenameSubmit = (id: string) => {
    if (editName.trim()) {
      renameCampaign(id, editName);
    }
    setEditingId(null);
  };

  const startRenaming = (c: Campaign) => {
    setEditingId(c.id);
    setEditName(c.name);
    setActiveMenuId(null);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteCampaign(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <div className="p-6 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B1120]">
      
      <ConfirmModal 
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete Campaign?"
        message="Are you sure you want to delete this campaign? All scheduled emails will be cancelled. This action cannot be undone."
        confirmText="Delete Campaign"
        isDanger={true}
      />

      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Campaigns</h2>
        <p className="text-slate-500 dark:text-slate-400">Manage, schedule, and track your outreach campaigns.</p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search campaigns..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <div className="relative group">
             <button className="flex items-center space-x-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap">
                <span>{statusFilter}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
             </button>
             {/* Simple Dropdown for Filter */}
             <div className="absolute top-full right-0 mt-2 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 hidden group-hover:block z-20">
               {['All statuses', 'Active', 'Paused', 'Completed', 'Draft'].map(s => (
                 <button key={s} onClick={() => setStatusFilter(s)} className="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{s}</button>
               ))}
             </div>
          </div>

          <button className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
             <Download className="w-5 h-5" />
          </button>

          <button 
            onClick={onNewCampaign}
            className="flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-lg shadow-blue-500/20 transition-all active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider items-center">
           <div className="col-span-4 pl-8">Name</div>
           <div className="col-span-2 text-center">Status</div>
           <div className="col-span-2">Progress</div>
           <div className="col-span-1 text-center">Sent</div>
           <div className="col-span-1 text-center">Click</div>
           <div className="col-span-1 text-center">Replied</div>
           <div className="col-span-1 text-right">Actions</div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
           {filteredCampaigns.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                   <BarChart3 className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="text-lg font-medium text-slate-600 dark:text-slate-300 mb-2">No campaigns found.</p>
                <p className="text-sm text-slate-500 mb-6">Create a new campaign to get started with your outreach.</p>
                <button 
                  onClick={onNewCampaign}
                  className="flex items-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-md transition-all active:scale-95"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create your first campaign
                </button>
             </div>
           ) : (
             filteredCampaigns.map((campaign) => (
               <div key={campaign.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-100 dark:border-slate-800 items-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group relative cursor-pointer" onClick={() => onSelectCampaign(campaign.id)}>
                  
                  {/* Name Column with Checkbox */}
                  <div className="col-span-4 flex items-center min-w-0 relative">
                     <div className="absolute left-0" onClick={(e) => e.stopPropagation()}>
                       <input type="checkbox" className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-transparent" />
                     </div>
                     <div className="pl-8 min-w-0">
                        {editingId === campaign.id ? (
                          <input 
                            autoFocus
                            className="bg-transparent border-b border-blue-500 text-slate-900 dark:text-white outline-none w-full font-medium"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => handleRenameSubmit(campaign.id)}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(campaign.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 className="text-sm font-medium text-slate-900 dark:text-white truncate group-hover:text-blue-600 transition-colors flex items-center" title={campaign.name}>
                            {campaign.name}
                            <ArrowRight className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500" />
                          </h3>
                        )}
                        <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{campaign.subject}</p>
                     </div>
                  </div>

                  {/* Status Column */}
                  <div className="col-span-2 flex justify-center">
                     <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-sm ${getStatusColor(campaign.status)}`}>
                        {campaign.status}
                     </span>
                  </div>

                  {/* Progress Column */}
                  <div className="col-span-2">
                     <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{campaign.progress}%</span>
                     </div>
                     <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full transition-all duration-500" 
                          style={{ width: `${campaign.progress}%` }} 
                        />
                     </div>
                  </div>

                  {/* Stats Columns */}
                  <div className="col-span-1 text-center text-sm text-slate-600 dark:text-slate-400 font-mono">
                     {campaign.stats.sent}
                  </div>
                  <div className="col-span-1 text-center text-sm text-slate-600 dark:text-slate-400 font-mono">
                     {campaign.stats.clicked}
                  </div>
                  <div className="col-span-1 text-center text-sm text-slate-600 dark:text-slate-400 font-mono">
                     {campaign.stats.replied}
                  </div>

                  {/* Actions Column */}
                  <div className="col-span-1 flex justify-end items-center gap-2 relative">
                     <button 
                       onClick={(e) => { e.stopPropagation(); toggleCampaignStatus(campaign.id); }}
                       className={`p-1.5 rounded-lg transition-colors ${campaign.status === 'ACTIVE' ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
                       title={campaign.status === 'ACTIVE' ? 'Pause Campaign' : 'Resume Campaign'}
                     >
                        {campaign.status === 'ACTIVE' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                     </button>
                     
                     <div className="relative">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === campaign.id ? null : campaign.id); }}
                          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                           <MoreVertical className="w-4 h-4" />
                        </button>

                        {/* Dropdown Menu */}
                        {activeMenuId === campaign.id && (
                           <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl z-50 py-1 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => startRenaming(campaign)} className="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center">
                                 <Edit3 className="w-4 h-4 mr-2" /> Rename
                              </button>
                              <button onClick={() => { duplicateCampaign(campaign.id); setActiveMenuId(null); }} className="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center">
                                 <Copy className="w-4 h-4 mr-2" /> Duplicate
                              </button>
                              <button className="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center">
                                 <Download className="w-4 h-4 mr-2" /> Download CSV
                              </button>
                              <button className="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center">
                                 <Share2 className="w-4 h-4 mr-2" /> Share
                              </button>
                              <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                              <button onClick={() => { setDeleteId(campaign.id); setActiveMenuId(null); }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center">
                                 <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
             ))
           )}
        </div>
      </div>
      
      {/* Overlay for closing menu */}
      {activeMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
      )}
    </div>
  );
};
