import React from 'react';
import { safeHttpUrl } from '../../services/safeUrl';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowUpRight,
  Clock,
  AlertCircle,
  Send,
  FolderOpen,
  Palette,
  Film,
  Sparkles,
} from 'lucide-react';
import { Button, Card, Badge, Textarea, Spinner, Alert, EmptyState, Eyebrow } from '@/src/design/ui';
import { blurIn } from '@/src/design/motion';
import { useRouter } from '../router';
import { StageTimeline } from '../components/StageTimeline';
import {
  fetchProject,
  requestRevision,
  approveRevision,
  postMessage,
  formatDate,
  timeAgo,
  type ProjectDetail,
  type FileType,
} from '../services/portalApi';

const FILE_GROUPS: { type: FileType; title: string; icon: React.ReactNode }[] = [
  { type: 'DELIVERABLE', title: 'Deliverables', icon: <Film className="h-4 w-4 text-volt-text" /> },
  { type: 'FILE_LINK', title: 'Your uploads & footage', icon: <FolderOpen className="h-4 w-4 text-neutral-400" /> },
  { type: 'BRAND_ASSET', title: 'Brand assets', icon: <Palette className="h-4 w-4 text-neutral-400" /> },
];

const REVISION_BADGE: Record<string, { variant: 'neutral' | 'volt' | 'success' | 'warning'; label: string }> = {
  OPEN: { variant: 'warning', label: 'Received' },
  IN_PROGRESS: { variant: 'volt', label: 'In progress' },
  SUBMITTED: { variant: 'volt', label: 'Ready for review' },
  APPROVED: { variant: 'success', label: 'Approved' },
};

export const ProjectPage: React.FC<{ id: string }> = ({ id }) => {
  const { navigate } = useRouter();
  const [project, setProject] = React.useState<ProjectDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [revisionNote, setRevisionNote] = React.useState('');
  const [revisionBusy, setRevisionBusy] = React.useState(false);
  const [messageBody, setMessageBody] = React.useState('');
  const [messageBusy, setMessageBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    fetchProject(id)
      .then((r) => setProject(r.project))
      .catch((e) => setError(e.message));
  }, [id]);

  React.useEffect(load, [load]);

  if (error) {
    return (
      <div className="py-10">
        <Alert variant="error" title="Couldn't load this project">{error}</Alert>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/')}>Back to projects</Button>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-volt-text" />
      </div>
    );
  }

  const submitRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevisionBusy(true);
    setActionError(null);
    try {
      await requestRevision(project.id, revisionNote);
      setRevisionNote('');
      load();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setRevisionBusy(false);
    }
  };

  const approve = async (revisionId: string) => {
    setActionError(null);
    try {
      await approveRevision(project.id, revisionId);
      load();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessageBusy(true);
    setActionError(null);
    try {
      await postMessage(project.id, messageBody);
      setMessageBody('');
      load();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setMessageBusy(false);
    }
  };

  return (
    <motion.div variants={blurIn} initial="hidden" animate="show">
      <button
        onClick={() => navigate('/')}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All projects
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{project.name}</h1>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <Clock className="h-3 w-3" /> Estimated delivery {formatDate(project.etaAt)} ·{' '}
            {project.progressPct}% complete · updated {timeAgo(project.updatedAt)}
          </p>
        </div>
        {project.status === 'ARCHIVED' && <Badge>Archived</Badge>}
      </div>

      {/* Stage timeline */}
      <Card className="mb-6" padding="lg">
        <StageTimeline stage={project.stage} />
      </Card>

      {/* Action needed / what happens next */}
      {project.waitingOnClient && (
        <Alert variant="warning" title="We need something from you" className="mb-6">
          {project.waitingOnClientNote || 'Check your messages below — progress resumes as soon as we have it.'}
        </Alert>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-volt-text" />
            <h2 className="text-sm font-semibold text-white">What happens next</h2>
          </div>
          <p className="text-sm leading-relaxed text-neutral-400">
            {project.nextStepNote ||
              "We're on it — the next update will appear here and in your activity feed."}
          </p>
        </Card>
        <Card>
          <Eyebrow className="mb-2">Project scope</Eyebrow>
          <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-400">
            {project.scopeSummary || 'Scope details will appear here once finalized.'}
          </p>
        </Card>
      </div>

      {actionError && <Alert variant="error" className="mb-6">{actionError}</Alert>}

      {/* Files */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-white">Files & deliverables</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {FILE_GROUPS.map((group) => {
            const files = project.fileLinks.filter((f) => f.type === group.type);
            return (
              <Card key={group.type} padding="sm">
                <div className="mb-3 flex items-center gap-2 px-1">
                  {group.icon}
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                    {group.title}
                  </h3>
                </div>
                {files.length === 0 ? (
                  <p className="px-1 pb-1 text-xs text-neutral-600">Nothing here yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {files.map((f) => (
                      <li key={f.id}>
                        <a
                          href={safeHttpUrl(f.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-sm text-neutral-300 hover:bg-white/[0.05] hover:text-white transition-colors"
                        >
                          <span className="truncate">{f.label}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {f.version > 1 && <Badge variant="neutral">v{f.version}</Badge>}
                            <ArrowUpRight className="h-3.5 w-3.5 text-neutral-600 group-hover:text-volt-text" />
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-600">
          Sharing footage or assets? Drop a link (Drive, Dropbox, WeTransfer, Frame.io…) in a message below.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revisions */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Revisions</h2>
            <span className="text-xs text-neutral-500">{project.revisions.length} round{project.revisions.length === 1 ? '' : 's'}</span>
          </div>

          <Card padding="sm" className="mb-3">
            <form onSubmit={submitRevision} className="space-y-2 p-1">
              <Textarea
                rows={2}
                required
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="Tell us exactly what to change…"
                aria-label="Revision request"
              />
              <Button type="submit" size="sm" loading={revisionBusy}>
                Request revision
              </Button>
            </form>
          </Card>

          {project.revisions.length === 0 ? (
            <EmptyState title="No revisions yet" hint="When you request changes, each round is tracked here." />
          ) : (
            <div className="space-y-2">
              {project.revisions.map((r) => {
                const badge = REVISION_BADGE[r.status] ?? REVISION_BADGE.OPEN;
                return (
                  <Card key={r.id} padding="sm">
                    <div className="flex items-start justify-between gap-3 p-1">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-semibold text-white">Round {r.roundNumber}</span>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                        <p className="text-sm text-neutral-400">{r.note}</p>
                        {r.respondedNote && (
                          <p className="mt-1.5 border-l-2 border-volt-text/40 pl-2 text-xs text-neutral-500">
                            {r.respondedNote}
                          </p>
                        )}
                      </div>
                      {r.status === 'SUBMITTED' && (
                        <Button size="sm" onClick={() => approve(r.id)}>
                          Approve
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Messages + activity */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">Messages</h2>
          <Card padding="sm" className="mb-3">
            <div className="max-h-64 space-y-2 overflow-y-auto p-1">
              {project.messages.length === 0 ? (
                <p className="py-2 text-center text-xs text-neutral-600">
                  Questions? Drop us a note — it goes straight to the team.
                </p>
              ) : (
                project.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.authorType === 'CLIENT'
                        ? 'ml-auto bg-volt/15 text-white'
                        : 'bg-white/[0.05] text-neutral-300'
                    }`}
                  >
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                      {m.authorLabel} · {timeAgo(m.createdAt)}
                    </p>
                    <p className="whitespace-pre-line">{m.body}</p>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={sendMessage} className="mt-2 flex gap-2 p-1">
              <input
                required
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Write a message…"
                aria-label="Message"
                className="w-full rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-volt-text/50 focus:outline-none"
              />
              <Button type="submit" size="sm" loading={messageBusy} aria-label="Send message">
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </Card>

          <h2 className="mb-3 mt-6 text-sm font-semibold text-white">Recent activity</h2>
          <Card padding="sm">
            {project.activities.length === 0 ? (
              <p className="p-2 text-xs text-neutral-600">Activity will appear here as work progresses.</p>
            ) : (
              <ul className="space-y-0.5 p-1">
                {project.activities.map((a) => (
                  <li key={a.id} className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-volt-text/70" aria-hidden />
                    <span className="min-w-0 flex-1 text-neutral-300">{a.summary}</span>
                    <span className="shrink-0 text-[10px] text-neutral-600">{timeAgo(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </motion.div>
  );
};
