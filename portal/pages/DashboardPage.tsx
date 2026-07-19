import React from 'react';
import { motion } from 'motion/react';
import { Plus, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button, Card, Badge, Modal, Input, Textarea, EmptyState, Spinner, Alert } from '@/src/design/ui';
import { staggerContainer, staggerItem } from '@/src/design/motion';
import { useRouter } from '../router';
import { stageLabel } from '../components/StageTimeline';
import {
  fetchProjects,
  requestNewProject,
  formatDate,
  timeAgo,
  type ProjectCard,
} from '../services/portalApi';

const ProgressBar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
    <div
      className="h-full rounded-full bg-volt shadow-[0_0_8px_rgb(2_1_255/0.6)] transition-all duration-700"
      style={{ width: `${Math.max(2, pct)}%` }}
    />
  </div>
);

export const DashboardPage: React.FC = () => {
  const { navigate } = useRouter();
  const [tab, setTab] = React.useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [projects, setProjects] = React.useState<ProjectCard[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [requestOpen, setRequestOpen] = React.useState(false);
  const [reqTitle, setReqTitle] = React.useState('');
  const [reqDetails, setReqDetails] = React.useState('');
  const [reqBusy, setReqBusy] = React.useState(false);
  const [reqDone, setReqDone] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProjects(null);
    fetchProjects(tab)
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e.message));
  }, [tab]);

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqBusy(true);
    try {
      const res = await requestNewProject(reqTitle, reqDetails);
      setReqDone(res.message);
      setReqTitle('');
      setReqDetails('');
    } catch (err: any) {
      setReqDone(null);
      setError(err.message);
    } finally {
      setReqBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Your projects</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Live status on everything we're making for you.
          </p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setRequestOpen(true); setReqDone(null); }}>
          Start New Project
        </Button>
      </div>

      <div className="mb-6 flex gap-1">
        {(['ACTIVE', 'ARCHIVED'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              tab === t ? 'bg-white/[0.08] text-white' : 'text-neutral-500 hover:text-white'
            }`}
          >
            {t === 'ACTIVE' ? 'Active' : 'Archive'}
          </button>
        ))}
      </div>

      {error && <Alert variant="error" className="mb-6">{error}</Alert>}

      {projects === null ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-volt-text" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          title={tab === 'ACTIVE' ? 'No active projects yet' : 'Nothing archived yet'}
          hint={
            tab === 'ACTIVE'
              ? 'When your project kicks off, its live status appears here.'
              : 'Completed projects land here so your active view stays clean.'
          }
          action={
            tab === 'ACTIVE' ? (
              <Button onClick={() => setRequestOpen(true)}>Start New Project</Button>
            ) : undefined
          }
        />
      ) : (
        <motion.div {...staggerContainer} className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <motion.div key={p.id} variants={staggerItem}>
              <Card
                hover
                className="cursor-pointer h-full"
                onClick={() => navigate(`/projects/${p.id}`)}
                role="link"
                aria-label={`Open project ${p.name}`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-white">{p.name}</h2>
                  <Badge variant={p.stage === 'COMPLETE' ? 'success' : 'volt'}>{stageLabel(p.stage)}</Badge>
                </div>

                {p.waitingOnClient && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <p className="text-xs text-amber-300">
                      {p.waitingOnClientNote || 'We need something from you to keep moving.'}
                    </p>
                  </div>
                )}
                {p.awaitingApprovalCount > 0 && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-volt-text/25 bg-volt/10 px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-volt-text" />
                    <p className="text-xs text-volt-text">A new cut is ready for your review</p>
                  </div>
                )}

                <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
                  <span>{p.progressPct}% complete</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    ETA {formatDate(p.etaAt)}
                  </span>
                </div>
                <ProgressBar pct={p.progressPct} />

                <p className="mt-4 truncate text-xs text-neutral-500">
                  {p.lastActivity
                    ? `${p.lastActivity.summary} · ${timeAgo(p.lastActivity.createdAt)}`
                    : `Updated ${timeAgo(p.updatedAt)}`}
                </p>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Modal isOpen={requestOpen} onClose={() => setRequestOpen(false)} title="Start a new project">
        {reqDone ? (
          <div className="space-y-4">
            <Alert variant="success" title="Request received">{reqDone}</Alert>
            <Button fullWidth variant="secondary" onClick={() => setRequestOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submitRequest} className="space-y-4">
            <p className="text-sm text-neutral-400">
              Tell us what you have in mind — we'll reply with scope and timing within one business day.
            </p>
            <Input
              label="What are we making?"
              required
              value={reqTitle}
              onChange={(e) => setReqTitle(e.target.value)}
              placeholder="e.g. 60s launch video for Q3"
            />
            <Textarea
              label="Details (optional)"
              rows={4}
              value={reqDetails}
              onChange={(e) => setReqDetails(e.target.value)}
              placeholder="Goals, references, deadline, anything useful…"
            />
            <Button type="submit" fullWidth loading={reqBusy}>
              Send request
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
};
