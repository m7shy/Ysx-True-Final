
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCampaigns } from '../context/CampaignContext';
import { Campaign } from '../types';
import { Search, Plus, Download, MoreVertical, Play, Pause, Trash2, Copy, FileText, Share2, Edit3, ChevronDown, ArrowRight, BarChart3 } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { EASE, staggerDelay, AnimatedHeading, MaskedReveal } from './motion/primitives';
import { Button, Badge, Input } from '../src/design/ui';

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

  // Per-row in-flight guards — toggling is non-idempotent (two rapid clicks can
  // flip the campaign back to its original state if the requests resolve out of order).
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // duplicatingId prevents a double-click from creating two copies.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'All statuses' || c.status === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  const getStatusVariant = (status: string): 'volt' | 'warning' | 'success' | 'neutral' => {
    switch (status) {
      case 'ACTIVE': return 'volt';
      case 'PAUSED': return 'warning';
      case 'COMPLETED': return 'success';
      case 'DRAFT': return 'neutral';
      case 'SCHEDULED': return 'volt';
      default: return 'neutral';
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
        <AnimatedHeading as="h2" className="text-2xl font-semibold text-white mb-2 tracking-tight">Campaigns</AnimatedHeading>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="text-neutral-400"
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 z-10" />
          <Input
            type="text"
            placeholder="Search campaigns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <div className="relative group">
             <button
               type="button"
               className="flex items-center space-x-2 px-4 py-2.5 bg-white/[0.02] border border-white/10 backdrop-blur-xl rounded-full text-sm font-medium text-neutral-300 hover:bg-white/[0.05] transition-colors duration-300 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
             >
                <span>{statusFilter}</span>
                <ChevronDown className="w-3 h-3 text-neutral-400" />
             </button>
             {/* Simple Dropdown for Filter */}
             <div className="absolute top-full right-0 mt-2 w-40 bg-noir/95 border border-white/10 backdrop-blur-xl rounded-2xl shadow-none py-1 hidden group-hover:block z-20">
               {['All statuses', 'Active', 'Paused', 'Completed', 'Draft'].map(s => (
                 <button key={s} type="button" onClick={() => setStatusFilter(s)} className="block w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-white/[0.05] transition-colors duration-300">{s}</button>
               ))}
             </div>
          </div>

          <button
            type="button"
            className="p-2.5 bg-white/[0.02] border border-white/10 backdrop-blur-xl rounded-full text-neutral-400 hover:text-white transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
            aria-label="Download campaigns as CSV"
            title="Download CSV"
          >
             <Download className="w-5 h-5" />
          </button>

          <Button onClick={onNewCampaign} leftIcon={<Plus className="w-4 h-4" />} className="whitespace-nowrap">
            Add New
          </Button>
        </div>
      </motion.div>

      {/* Table Container */}
      <MaskedReveal delay={0.25} className="flex-1 bg-white/[0.02] backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden flex flex-col">
        {/* Table Header */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/10 bg-white/[0.02] text-xs font-semibold text-neutral-400 uppercase tracking-wider items-center">
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
               className="flex flex-col items-center justify-center h-full text-neutral-400"
             >
                <div className="w-16 h-16 bg-white/[0.02] border border-white/10 rounded-full flex items-center justify-center mb-4">
                   <BarChart3 className="w-8 h-8 text-neutral-600" />
                </div>
                <p className="text-lg font-medium text-neutral-300 mb-2">No campaigns found.</p>
                <p className="text-sm text-neutral-500 mb-6">Create a new campaign to get started with your outreach.</p>
                <Button onClick={onNewCampaign} leftIcon={<Plus className="w-4 h-4" />}>
                  Create your first campaign
                </Button>
             </motion.div>
           ) : (
             filteredCampaigns.map((campaign, index) => (
               <motion.div
                 key={campaign.id}
                 layout={editingId === null}
                 initial={{ opacity: 0, y: 12 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.5, ease: EASE, delay: staggerDelay(index) }}
                 className="relative grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/5 items-center hover:bg-white/[0.03] transition-colors duration-300 group"
               >
                  {/* Stretched click target for the row (kept behind nested interactive controls) */}
                  <button
                    type="button"
                    className="absolute inset-0 w-full h-full z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt-text"
                    onClick={() => onSelectCampaign(campaign.id)}
                    aria-label={`Open campaign ${campaign.name}`}
                  />

                  {/* Name Column with Checkbox */}
                  <div className="col-span-4 flex items-center min-w-0 relative z-10 pointer-events-none">
                     <div className="absolute left-0 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                       <input type="checkbox" aria-label={`Select ${campaign.name}`} className="rounded border-white/20 text-volt focus:ring-volt-text bg-transparent" />
                     </div>
                     <div className="pl-8 min-w-0 pointer-events-auto">
                        {editingId === campaign.id ? (
                          <input
                            autoFocus
                            className="bg-transparent border-b border-volt text-white outline-none w-full font-medium"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => handleRenameSubmit(campaign.id)}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(campaign.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 className="text-sm font-medium text-white truncate group-hover:text-volt-text transition-colors duration-300 flex items-center" title={campaign.name}>
                            {campaign.name}
                            <ArrowRight className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-volt-text" />
                          </h3>
                        )}
                        <p className="text-xs text-neutral-500 truncate">{campaign.subject}</p>
                     </div>
                  </div>

                  {/* Status Column */}
                  <div className="col-span-2 flex justify-center relative z-10 pointer-events-none">
                     <Badge variant={getStatusVariant(campaign.status)}>
                        {campaign.status}
                     </Badge>
                  </div>

                  {/* Progress Column */}
                  <div className="col-span-2 relative z-10 pointer-events-none">
                     <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-neutral-300">{campaign.progress}%</span>
                     </div>
                     <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-volt rounded-full shadow-glow"
                          initial={{ width: 0 }}
                          animate={{ width: `${campaign.progress}%` }}
                          transition={{ duration: 0.8, ease: EASE, delay: staggerDelay(index) + 0.2 }}
                        />
                     </div>
                  </div>

                  {/* Stats Columns */}
                  <div className="col-span-1 text-center text-sm text-neutral-400 font-mono relative z-10 pointer-events-none">
                     {campaign.stats.sent}
                  </div>
                  <div className="col-span-1 text-center text-sm text-neutral-400 font-mono relative z-10 pointer-events-none">
                     {campaign.stats.clicked}
                  </div>
                  <div className="col-span-1 text-center text-sm text-neutral-400 font-mono relative z-10 pointer-events-none">
                     {campaign.stats.replied}
                  </div>

                  {/* Actions Column */}
                  <div className="col-span-1 flex justify-end items-center gap-2 relative z-10 pointer-events-none">
                     <button
                       type="button"
                       onClick={async (e) => {
                         e.stopPropagation();
                         // Guard against double-click: toggling is non-idempotent, so two rapid
                         // clicks can leave the campaign in the opposite state to what was intended.
                         if (togglingId === campaign.id) return;
                         setTogglingId(campaign.id);
                         try {
                           await toggleCampaignStatus(campaign.id);
                         } finally {
                           setTogglingId(null);
                         }
                       }}
                       disabled={togglingId === campaign.id}
                       className={`pointer-events-auto p-1.5 rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text disabled:opacity-40 disabled:cursor-not-allowed ${campaign.status === 'ACTIVE' ? 'text-volt-text hover:bg-volt/10' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/10'}`}
                       aria-label={campaign.status === 'ACTIVE' ? `Pause ${campaign.name}` : `Resume ${campaign.name}`}
                       title={campaign.status === 'ACTIVE' ? 'Pause Campaign' : 'Resume Campaign'}
                     >
                        {campaign.status === 'ACTIVE' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                     </button>

                     <div className="relative pointer-events-auto">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === campaign.id ? null : campaign.id); }}
                          className="p-1.5 text-neutral-400 hover:text-neutral-200 rounded-full hover:bg-white/10 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text"
                          aria-label={`More actions for ${campaign.name}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === campaign.id}
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
                               className="absolute right-0 top-full mt-2 w-48 bg-noir/95 border border-white/10 backdrop-blur-xl rounded-2xl shadow-none z-50 py-1 origin-top-right"
                               onClick={(e) => e.stopPropagation()}
                               role="menu"
                             >
                                <button type="button" onClick={() => startRenaming(campaign)} className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-white/[0.05] flex items-center transition-colors duration-300">
                                   <Edit3 className="w-4 h-4 mr-2" /> Rename
                                </button>
                                <button
                                   type="button"
                                   disabled={duplicatingId === campaign.id}
                                   onClick={async () => {
                                     // Guard against double-click creating two copies.
                                     if (duplicatingId === campaign.id) return;
                                     setDuplicatingId(campaign.id);
                                     try {
                                       await duplicateCampaign(campaign.id);
                                       setActiveMenuId(null);
                                     } finally {
                                       setDuplicatingId(null);
                                     }
                                   }}
                                   className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-white/[0.05] flex items-center transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                   <Copy className="w-4 h-4 mr-2" /> {duplicatingId === campaign.id ? 'Duplicating…' : 'Duplicate'}
                                </button>
                                <button type="button" className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-white/[0.05] flex items-center transition-colors duration-300">
                                   <Download className="w-4 h-4 mr-2" /> Download CSV
                                </button>
                                <button type="button" className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-white/[0.05] flex items-center transition-colors duration-300">
                                   <Share2 className="w-4 h-4 mr-2" /> Share
                                </button>
                                <div className="h-px bg-white/10 my-1" />
                                <button type="button" onClick={() => { setDeleteId(campaign.id); setActiveMenuId(null); }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center transition-colors duration-300">
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
        <button
          type="button"
          className="fixed inset-0 z-10 cursor-default"
          onClick={() => setActiveMenuId(null)}
          aria-label="Close menu"
        />
      )}
    </div>
  );
};
