
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCampaigns } from '../context/CampaignContext';
import { Campaign } from '../types';
import { Search, Plus, Download, MoreVertical, Play, Pause, Trash2, Copy, FileText, Share2, Edit3, ChevronDown, ArrowRight, BarChart3 } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { EASE, staggerDelay, AnimatedHeading, MaskedReveal } from './motion/primitives';

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
      case 'ACTIVE': return 'bg-blue-500/15 text-blue-300 border border-blue-400/20';
      case 'PAUSED': return 'bg-amber-500/15 text-amber-300 border border-amber-400/20';
      case 'COMPLETED': return 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20';
      case 'DRAFT': return 'bg-white/10 text-slate-300 border border-white/10';
      case 'SCHEDULED': return 'bg-purple-500/15 text-purple-300 border border-purple-400/20';
      default: return 'bg-white/10 text-slate-300 border border-white/10';
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
    <div className="p-6 md:p-8 h-full flex flex-col overflow-hidden bg-transparent">

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
        <AnimatedHeading as="h2" className="text-2xl font-bold text-white mb-2 tracking-tight">Campaigns</AnimatedHeading>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="text-slate-400"
        >
          Manage, schedule, and track your outreach campaigns.
        </motion.p>
      </div>

      {/* Toolbar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
        className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6"
      >
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search campaigns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 backdrop-blur-xl rounded-lg text-sm text-white focus:ring-2 focus:ring-brand-500 outline-none placeholder-slate-500 transition-shadow duration-300"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <div className="relative group">
             <button className="flex items-center space-x-2 px-4 py-2.5 bg-white/5 border border-white/10 backdrop-blur-xl rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors duration-300 whitespace-nowrap">
                <span>{statusFilter}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
             </button>
             {/* Simple Dropdown for Filter */}
             <div className="absolute top-full right-0 mt-2 w-40 bg-canvas/95 border border-white/10 backdrop-blur-xl rounded-lg shadow-xl py-1 hidden group-hover:block z-20">
               {['All statuses', 'Active', 'Paused', 'Completed', 'Draft'].map(s => (
                 <button key={s} onClick={() => setStatusFilter(s)} className="block w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors duration-300">{s}</button>
               ))}
             </div>
          </div>

          <button className="p-2.5 bg-white/5 border border-white/10 backdrop-blur-xl rounded-lg text-slate-400 hover:text-white transition-colors duration-300">
             <Download className="w-5 h-5" />
          </button>

          <button
            onClick={onNewCampaign}
            className="flex items-center px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium shadow-glow transition-all duration-300 active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New
          </button>
        </div>
      </motion.div>

      {/* Table Container */}
      <MaskedReveal delay={0.25} className="flex-1 bg-white/5 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden flex flex-col">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/10 bg-white/5 text-xs font-bold text-slate-400 uppercase tracking-wider items-center">
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
             <motion.div
               initial={{ opacity: 0, scale: 0.97 }}
               animate={{ opacity: 1, scale: 1 }}
               transition={{ duration: 0.5, ease: EASE, delay: 0.3 }}
               className="flex flex-col items-center justify-center h-full text-slate-400"
             >
                <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-full flex items-center justify-center mb-4">
                   <BarChart3 className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-lg font-medium text-slate-300 mb-2">No campaigns found.</p>
                <p className="text-sm text-slate-500 mb-6">Create a new campaign to get started with your outreach.</p>
                <button
                  onClick={onNewCampaign}
                  className="flex items-center px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium shadow-glow transition-all duration-300 active:scale-95"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create your first campaign
                </button>
             </motion.div>
           ) : (
             filteredCampaigns.map((campaign, index) => (
               <motion.div
                 key={campaign.id}
                 layout={editingId === null}
                 initial={{ opacity: 0, y: 12 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.5, ease: EASE, delay: staggerDelay(index) }}
                 className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/5 items-center hover:bg-white/5 transition-colors duration-300 group relative cursor-pointer"
                 onClick={() => onSelectCampaign(campaign.id)}
               >

                  {/* Name Column with Checkbox */}
                  <div className="col-span-4 flex items-center min-w-0 relative">
                     <div className="absolute left-0" onClick={(e) => e.stopPropagation()}>
                       <input type="checkbox" className="rounded border-white/20 text-brand-600 focus:ring-brand-500 bg-transparent" />
                     </div>
                     <div className="pl-8 min-w-0">
                        {editingId === campaign.id ? (
                          <input
                            autoFocus
                            className="bg-transparent border-b border-brand-500 text-white outline-none w-full font-medium"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => handleRenameSubmit(campaign.id)}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(campaign.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 className="text-sm font-medium text-white truncate group-hover:text-brand-400 transition-colors duration-300 flex items-center" title={campaign.name}>
                            {campaign.name}
                            <ArrowRight className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-brand-400" />
                          </h3>
                        )}
                        <p className="text-xs text-slate-500 truncate">{campaign.subject}</p>
                     </div>
                  </div>

                  {/* Status Column */}
                  <div className="col-span-2 flex justify-center">
                     <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${getStatusColor(campaign.status)}`}>
                        {campaign.status}
                     </span>
                  </div>

                  {/* Progress Column */}
                  <div className="col-span-2">
                     <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-300">{campaign.progress}%</span>
                     </div>
                     <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-brand-500 rounded-full shadow-glow"
                          initial={{ width: 0 }}
                          animate={{ width: `${campaign.progress}%` }}
                          transition={{ duration: 0.8, ease: EASE, delay: staggerDelay(index) + 0.2 }}
                        />
                     </div>
                  </div>

                  {/* Stats Columns */}
                  <div className="col-span-1 text-center text-sm text-slate-400 font-mono">
                     {campaign.stats.sent}
                  </div>
                  <div className="col-span-1 text-center text-sm text-slate-400 font-mono">
                     {campaign.stats.clicked}
                  </div>
                  <div className="col-span-1 text-center text-sm text-slate-400 font-mono">
                     {campaign.stats.replied}
                  </div>

                  {/* Actions Column */}
                  <div className="col-span-1 flex justify-end items-center gap-2 relative">
                     <button
                       onClick={(e) => { e.stopPropagation(); toggleCampaignStatus(campaign.id); }}
                       className={`p-1.5 rounded-lg transition-colors duration-300 ${campaign.status === 'ACTIVE' ? 'text-brand-400 hover:bg-brand-900/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'}`}
                       title={campaign.status === 'ACTIVE' ? 'Pause Campaign' : 'Resume Campaign'}
                     >
                        {campaign.status === 'ACTIVE' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                     </button>

                     <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === campaign.id ? null : campaign.id); }}
                          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/10 transition-colors duration-300"
                        >
                           <MoreVertical className="w-4 h-4" />
                        </button>

                        {/* Dropdown Menu */}
                        <AnimatePresence>
                          {activeMenuId === campaign.id && (
                             <motion.div
                               initial={{ opacity: 0, scale: 0.95, y: -4 }}
                               animate={{ opacity: 1, scale: 1, y: 0 }}
                               exit={{ opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.12 } }}
                               transition={{ duration: 0.25, ease: EASE }}
                               className="absolute right-0 top-full mt-2 w-48 bg-canvas/95 border border-white/10 backdrop-blur-xl rounded-lg shadow-xl z-50 py-1 origin-top-right"
                               onClick={(e) => e.stopPropagation()}
                             >
                                <button onClick={() => startRenaming(campaign)} className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 flex items-center transition-colors duration-300">
                                   <Edit3 className="w-4 h-4 mr-2" /> Rename
                                </button>
                                <button onClick={() => { duplicateCampaign(campaign.id); setActiveMenuId(null); }} className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 flex items-center transition-colors duration-300">
                                   <Copy className="w-4 h-4 mr-2" /> Duplicate
                                </button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 flex items-center transition-colors duration-300">
                                   <Download className="w-4 h-4 mr-2" /> Download CSV
                                </button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 flex items-center transition-colors duration-300">
                                   <Share2 className="w-4 h-4 mr-2" /> Share
                                </button>
                                <div className="h-px bg-white/10 my-1" />
                                <button onClick={() => { setDeleteId(campaign.id); setActiveMenuId(null); }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center transition-colors duration-300">
                                   <Trash2 className="w-4 h-4 mr-2" /> Delete
                                </button>
                             </motion.div>
                          )}
                        </AnimatePresence>
                     </div>
                  </div>
               </motion.div>
             ))
           )}
        </div>
      </MaskedReveal>

      {/* Overlay for closing menu */}
      {activeMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
      )}
    </div>
  );
};
