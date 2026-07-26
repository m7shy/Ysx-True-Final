import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Plus, Send, UserPlus, Archive, ExternalLink, Check } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import {
  Button,
  Card,
  Badge,
  Modal,
  Input,
  Textarea,
  Select,
  Alert,
  EmptyState,
  Spinner,
  Eyebrow,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '../src/design/ui';
import { blurIn } from '../src/design/motion';
import {
  STAGES,
  fetchAdminClients,
  createClient,
  inviteClientUser,
  fetchAdminProjects,
  fetchAdminProject,
  createProject,
  updateProject,
  archiveProject,
  addFileLink,
  deleteFileLink,
  updateRevision,
  postAdminMessage,
  fetchAdminInvoices,
  createInvoice,
  sendInvoice,
  markInvoicePaid,
  type AdminClient,
  type AdminProject,
  type AdminInvoice,
  type ProjectStage,
  type FileType,
  type RevisionStatus,
} from '../services/portalAdminApi';

/**
 * Admin side of the client portal: manage clients, their projects (the mirror
 * of the portal's project page, with write controls), and invoices — one view,
 * three tabs, drill-in detail for projects.
 */

type Tab = 'CLIENTS' | 'PROJECTS' | 'INVOICES';

const money = (cents: number, cur = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);
const dateStr = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const STAGE_LABEL: Record<ProjectStage, string> = {
  ONBOARDING: 'Onboarding',
  EDITING: 'Editing',
  REVISION: 'Revision',
  FINAL_DELIVERY: 'Final Delivery',
  COMPLETE: 'Complete',
};

const INVOICE_BADGE: Record<string, 'neutral' | 'volt' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'volt',
  VIEWED: 'volt',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
};

const ClientPortalView: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>('CLIENTS');
  const [projectId, setProjectId] = React.useState<string | null>(null);

  return (
    <motion.div variants={blurIn} initial="hidden" animate="show" className="space-y-6">
      {projectId ? (
        <ProjectDetail id={projectId} onBack={() => setProjectId(null)} />
      ) : (
        <>
          <div className="flex gap-1">
            {(['CLIENTS', 'PROJECTS', 'INVOICES'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                  tab === t ? 'bg-white/[0.08] text-white' : 'text-neutral-500 hover:text-white'
                }`}
              >
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {tab === 'CLIENTS' && <ClientsTab />}
          {tab === 'PROJECTS' && <ProjectsTab onOpen={setProjectId} />}
          {tab === 'INVOICES' && <InvoicesTab />}
        </>
      )}
    </motion.div>
  );
};

// ── Clients ────────────────────────────────────────────────────────────────

const ClientsTab: React.FC = () => {
  const [clients, setClients] = React.useState<AdminClient[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [inviteFor, setInviteFor] = React.useState<AdminClient | null>(null);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteNote, setInviteNote] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    fetchAdminClients().then((r) => setClients(r.clients)).catch((e) => setError(e.message));
  }, []);
  React.useEffect(load, [load]);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createClient(name, company);
      setCreateOpen(false);
      setName('');
      setCompany('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteFor) return;
    setBusy(true);
    setInviteNote(null);
    try {
      await inviteClientUser(inviteFor.id, inviteEmail);
      setInviteNote(`Invite sent to ${inviteEmail}`);
      setInviteEmail('');
      load();
    } catch (err: any) {
      setInviteNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
          New Client
        </Button>
      </div>
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {clients === null ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-volt-text" /></div>
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          hint="Create a client, then invite them to their portal."
          action={<Button onClick={() => setCreateOpen(true)}>New Client</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {clients.map((c) => (
            <Card key={c.id}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">{c.name}</h3>
                  {c.companyName && <p className="text-xs text-neutral-500">{c.companyName}</p>}
                </div>
                <Badge variant={c.status === 'ACTIVE' ? 'volt' : 'neutral'}>{c.status}</Badge>
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                {c.projectCount} project{c.projectCount === 1 ? '' : 's'} · {c.invoiceCount} invoice
                {c.invoiceCount === 1 ? '' : 's'}
              </p>
              {c.portalUsers.length > 0 ? (
                <ul className="mb-3 space-y-1">
                  {c.portalUsers.map((u) => (
                    <li key={u.id} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-300">{u.email}</span>
                      <span className="text-neutral-600">
                        {u.lastLoginAt ? `last login ${dateStr(u.lastLoginAt)}` : u.hasPassword ? 'never logged in' : 'invited'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-3 text-xs text-amber-400/80">No portal access yet — send an invite.</p>
              )}
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<UserPlus className="h-3.5 w-3.5" />}
                onClick={() => {
                  setInviteFor(c);
                  setInviteNote(null);
                }}
              >
                Invite to portal
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New client">
        <form onSubmit={submitCreate} className="space-y-4">
          <Input label="Client name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
          <Button type="submit" fullWidth loading={busy}>Create client</Button>
        </form>
      </Modal>

      <Modal isOpen={Boolean(inviteFor)} onClose={() => setInviteFor(null)} title={`Invite — ${inviteFor?.name ?? ''}`}>
        <form onSubmit={submitInvite} className="space-y-4">
          <p className="text-sm text-neutral-400">
            Sends a set-password link (valid 7 days) from your connected mailbox.
          </p>
          <Input
            label="Client email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          {inviteNote && (
            <Alert variant={inviteNote.startsWith('Invite sent') ? 'success' : 'error'}>{inviteNote}</Alert>
          )}
          <Button type="submit" fullWidth loading={busy}>Send invite</Button>
        </form>
      </Modal>
    </div>
  );
};

// ── Projects ───────────────────────────────────────────────────────────────

const ProjectsTab: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [projects, setProjects] = React.useState<AdminProject[] | null>(null);
  const [clients, setClients] = React.useState<AdminClient[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState({ clientId: '', name: '', scopeSummary: '', etaAt: '' });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    fetchAdminProjects().then((r) => setProjects(r.projects)).catch((e) => setError(e.message));
    fetchAdminClients().then((r) => setClients(r.clients)).catch(() => {});
  }, []);
  React.useEffect(load, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProject({
        clientId: form.clientId,
        name: form.name,
        scopeSummary: form.scopeSummary || undefined,
        etaAt: form.etaAt || undefined,
      });
      setCreateOpen(false);
      setForm({ clientId: '', name: '', scopeSummary: '', etaAt: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
          New Project
        </Button>
      </div>
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {projects === null ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-volt-text" /></div>
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" hint="Create one and it appears in the client's portal instantly." />
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Client</TH>
                <TH>Stage</TH>
                <TH>Progress</TH>
                <TH>ETA</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {projects.map((p) => (
                <TR key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
                  <TD className="font-medium text-white">{p.name}</TD>
                  <TD className="text-neutral-400">{p.client?.name}</TD>
                  <TD><Badge variant="volt">{STAGE_LABEL[p.stage]}</Badge></TD>
                  <TD className="text-neutral-400">{p.progressPct}%</TD>
                  <TD className="text-neutral-400">{dateStr(p.etaAt)}</TD>
                  <TD>
                    {p.waitingOnClient ? (
                      <Badge variant="warning">Waiting on client</Badge>
                    ) : (
                      <Badge variant={p.status === 'ACTIVE' ? 'neutral' : 'neutral'}>{p.status}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New project">
        <form onSubmit={submit} className="space-y-4">
          <Select
            label="Client"
            required
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
          >
            <option value="" disabled>Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.companyName ? ` — ${c.companyName}` : ''}</option>
            ))}
          </Select>
          <Input label="Project name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="ETA (optional)" type="date" value={form.etaAt} onChange={(e) => setForm({ ...form, etaAt: e.target.value })} />
          <Textarea
            label="Scope / included deliverables (client-visible)"
            rows={3}
            value={form.scopeSummary}
            onChange={(e) => setForm({ ...form, scopeSummary: e.target.value })}
          />
          <Button type="submit" fullWidth loading={busy}>Create project</Button>
        </form>
      </Modal>
    </div>
  );
};

// ── Project detail (admin write controls) ──────────────────────────────────

const ProjectDetail: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [project, setProject] = React.useState<AdminProject | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedTick, setSavedTick] = React.useState(false);

  const [status, setStatus] = React.useState({
    stage: 'ONBOARDING' as ProjectStage,
    progressPct: 0,
    etaAt: '',
    nextStepNote: '',
    waitingOnClient: false,
    waitingOnClientNote: '',
    scopeSummary: '',
  });

  const [file, setFile] = React.useState({ type: 'DELIVERABLE' as FileType, label: '', url: '' });
  const [msg, setMsg] = React.useState('');
  const [deliverTarget, setDeliverTarget] = React.useState<{ id: string; roundNumber: number } | null>(null);
  const [deliverNote, setDeliverNote] = React.useState('');
  const [deliverBusy, setDeliverBusy] = React.useState(false);

  // Archive project confirmation/in-flight state
  const [archiveConfirm, setArchiveConfirm] = React.useState(false);
  const [archiveBusy, setArchiveBusy] = React.useState(false);

  // File-link removal confirmation/in-flight state
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; label: string } | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);

  const load = React.useCallback(() => {
    fetchAdminProject(id)
      .then((r) => {
        setProject(r.project);
        setStatus({
          stage: r.project.stage,
          progressPct: r.project.progressPct,
          etaAt: r.project.etaAt ? r.project.etaAt.slice(0, 10) : '',
          nextStepNote: r.project.nextStepNote ?? '',
          waitingOnClient: r.project.waitingOnClient,
          waitingOnClientNote: r.project.waitingOnClientNote ?? '',
          scopeSummary: r.project.scopeSummary ?? '',
        });
      })
      .catch((e) => setError(e.message));
  }, [id]);
  React.useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProject(id, {
        stage: status.stage,
        progressPct: Number(status.progressPct),
        etaAt: status.etaAt || null,
        nextStepNote: status.nextStepNote || null,
        waitingOnClient: status.waitingOnClient,
        waitingOnClientNote: status.waitingOnClientNote || null,
        scopeSummary: status.scopeSummary || null,
      });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addFileLink(id, file);
      setFile({ ...file, label: '', url: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const sendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await postAdminMessage(id, msg);
      setMsg('');
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const setRevision = async (revisionId: string, data: { status?: RevisionStatus; respondedNote?: string }) => {
    try {
      await updateRevision(id, revisionId, data);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const confirmDeliver = async () => {
    if (!deliverTarget) return;
    setDeliverBusy(true);
    try {
      await updateRevision(id, deliverTarget.id, {
        status: 'SUBMITTED',
        ...(deliverNote.trim() ? { respondedNote: deliverNote.trim() } : {}),
      });
      setDeliverTarget(null);
      setDeliverNote('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeliverBusy(false);
    }
  };

  const confirmArchive = async () => {
    setArchiveBusy(true);
    try {
      await archiveProject(id);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setArchiveBusy(false);
    }
  };

  const confirmRemoveFile = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await deleteFileLink(id, removeTarget.id);
      setRemoveTarget(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemoveBusy(false);
    }
  };

  if (error && !project) return <Alert variant="error">{error}</Alert>;
  if (!project) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-volt-text" /></div>;

  return (
    <div>
      {/* ConfirmModal for archive: non-reversible, so requires confirmation */}
      <ConfirmModal
        isOpen={archiveConfirm}
        onClose={() => setArchiveConfirm(false)}
        onConfirm={confirmArchive}
        title="Archive project?"
        message="The project will be hidden from the client's portal. You can restore it from the database if needed."
        confirmText="Archive"
        isDanger={true}
      />

      {/* ConfirmModal for file-link removal */}
      <ConfirmModal
        isOpen={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveFile}
        title={`Remove ${removeTarget?.label ?? 'file'}?`}
        message="This removes the link from the client's portal. The file itself is not deleted."
        confirmText="Remove"
        isDanger={true}
      />

      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> All projects
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">{project.name}</h2>
          <p className="text-xs text-neutral-500">{project.client?.name}</p>
        </div>
        <div className="flex gap-2">
          {project.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Archive className="h-3.5 w-3.5" />}
              loading={archiveBusy}
              onClick={() => setArchiveConfirm(true)}
            >
              Archive
            </Button>
          )}
          <Button size="sm" loading={saving} leftIcon={savedTick ? <Check className="h-3.5 w-3.5" /> : undefined} onClick={save}>
            {savedTick ? 'Saved' : 'Save status'}
          </Button>
        </div>
      </div>

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Status controls — everything the client sees */}
        <Card>
          <Eyebrow className="mb-3">Client-visible status</Eyebrow>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select label="Stage" value={status.stage} onChange={(e) => setStatus({ ...status, stage: e.target.value as ProjectStage })}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                ))}
              </Select>
              <Input
                label={`Progress — ${status.progressPct}%`}
                type="number"
                min={0}
                max={100}
                value={String(status.progressPct)}
                onChange={(e) => setStatus({ ...status, progressPct: Number(e.target.value) })}
              />
            </div>
            <Input label="Estimated delivery" type="date" value={status.etaAt} onChange={(e) => setStatus({ ...status, etaAt: e.target.value })} />
            <Textarea
              label='"What happens next" (client sees this verbatim)'
              rows={2}
              value={status.nextStepNote}
              onChange={(e) => setStatus({ ...status, nextStepNote: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={status.waitingOnClient}
                onChange={(e) => setStatus({ ...status, waitingOnClient: e.target.checked })}
                className="h-4 w-4 rounded border-white/20 bg-white/[0.03] accent-[#0201ff]"
              />
              Waiting on client
            </label>
            {status.waitingOnClient && (
              <Input
                label="What do you need from them?"
                value={status.waitingOnClientNote}
                onChange={(e) => setStatus({ ...status, waitingOnClientNote: e.target.value })}
              />
            )}
            <Textarea
              label="Scope / included deliverables"
              rows={3}
              value={status.scopeSummary}
              onChange={(e) => setStatus({ ...status, scopeSummary: e.target.value })}
            />
          </div>
        </Card>

        {/* Files */}
        <Card>
          <Eyebrow className="mb-3">Files & deliverables</Eyebrow>
          <form onSubmit={submitFile} className="mb-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={file.type} onChange={(e) => setFile({ ...file, type: e.target.value as FileType })} aria-label="File type">
                <option value="DELIVERABLE">Deliverable</option>
                <option value="FILE_LINK">Client upload / footage</option>
                <option value="BRAND_ASSET">Brand asset</option>
              </Select>
              <Input placeholder="Label (e.g. Final Cut)" required value={file.label} onChange={(e) => setFile({ ...file, label: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Input placeholder="https:// link (Drive, Frame.io…)" required type="url" value={file.url} onChange={(e) => setFile({ ...file, url: e.target.value })} className="flex-1" />
              <Button type="submit" size="sm">Add</Button>
            </div>
          </form>
          <ul className="space-y-1">
            {(project.fileLinks ?? []).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03]">
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-neutral-300 hover:text-white">
                  <ExternalLink className="h-3 w-3 shrink-0 text-neutral-600" />
                  <span className="truncate">{f.label}</span>
                  {f.version > 1 && <Badge variant="neutral">v{f.version}</Badge>}
                  <Badge variant="neutral">{f.type.replace('_', ' ').toLowerCase()}</Badge>
                </a>
                <button
                  onClick={() => setRemoveTarget({ id: f.id, label: f.label })}
                  className="text-xs text-neutral-600 hover:text-red-400"
                  aria-label={`Remove ${f.label}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Revisions */}
        <Card>
          <Eyebrow className="mb-3">Revisions</Eyebrow>
          {(project.revisions ?? []).length === 0 ? (
            <p className="text-xs text-neutral-600">No revision requests yet.</p>
          ) : (
            <div className="space-y-2">
              {(project.revisions ?? []).map((r) => (
                <div key={r.id} className="rounded-xl border border-white/10 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Round {r.roundNumber}</span>
                    <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'SUBMITTED' ? 'volt' : 'warning'}>
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mb-2 text-sm text-neutral-400">{r.note}</p>
                  {r.status !== 'APPROVED' && (
                    <div className="flex flex-wrap gap-2">
                      {r.status === 'OPEN' && (
                        <Button size="sm" variant="secondary" onClick={() => setRevision(r.id, { status: 'IN_PROGRESS' })}>
                          Start
                        </Button>
                      )}
                      {r.status !== 'SUBMITTED' && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setDeliverTarget({ id: r.id, roundNumber: r.roundNumber });
                            setDeliverNote(r.respondedNote ?? '');
                          }}
                        >
                          Mark delivered
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Messages + activity */}
        <Card>
          <Eyebrow className="mb-3">Messages</Eyebrow>
          <div className="mb-3 max-h-48 space-y-2 overflow-y-auto">
            {(project.messages ?? []).map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.authorType === 'ADMIN' ? 'ml-auto bg-volt/15 text-white' : 'bg-white/[0.05] text-neutral-300'}`}>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{m.authorLabel}</p>
                <p className="whitespace-pre-line">{m.body}</p>
              </div>
            ))}
          </div>
          <form onSubmit={sendMsg} className="flex gap-2">
            <Input placeholder="Message the client…" required value={msg} onChange={(e) => setMsg(e.target.value)} className="flex-1" aria-label="Message" />
            <Button type="submit" size="sm" aria-label="Send"><Send className="h-3.5 w-3.5" /></Button>
          </form>

          <Eyebrow className="mb-2 mt-5">Recent activity</Eyebrow>
          <ul className="space-y-1">
            {(project.activities ?? []).slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-neutral-400">{a.summary}</span>
                <span className="shrink-0 text-neutral-600">{dateStr(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal
        isOpen={Boolean(deliverTarget)}
        onClose={() => setDeliverTarget(null)}
        title={deliverTarget ? `Mark round ${deliverTarget.roundNumber} delivered` : ''}
      >
        <div className="space-y-4">
          <Textarea
            label="Note to the client (what changed) — optional"
            rows={3}
            value={deliverNote}
            onChange={(e) => setDeliverNote(e.target.value)}
            placeholder="e.g. Tightened the intro by 2s, swapped the music track"
          />
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setDeliverTarget(null)}>
              Cancel
            </Button>
            <Button fullWidth loading={deliverBusy} onClick={confirmDeliver}>
              Mark delivered
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ── Invoices ───────────────────────────────────────────────────────────────

const InvoicesTab: React.FC = () => {
  const [invoices, setInvoices] = React.useState<AdminInvoice[] | null>(null);
  const [clients, setClients] = React.useState<AdminClient[]>([]);
  const [projects, setProjects] = React.useState<AdminProject[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ clientId: '', projectId: '', amount: '', dueAt: '', notes: '' });
  const [payTarget, setPayTarget] = React.useState<{ id: string; number: string } | null>(null);
  const [payReference, setPayReference] = React.useState('');
  const [payBusy, setPayBusy] = React.useState(false);

  const load = React.useCallback(() => {
    fetchAdminInvoices().then((r) => setInvoices(r.invoices)).catch((e) => setError(e.message));
    fetchAdminClients().then((r) => setClients(r.clients)).catch(() => {});
    fetchAdminProjects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);
  React.useEffect(load, [load]);

  const confirmMarkPaid = async () => {
    if (!payTarget) return;
    setPayBusy(true);
    try {
      await markInvoicePaid(payTarget.id, payReference.trim() || undefined);
      setPayTarget(null);
      setPayReference('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPayBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createInvoice({
        clientId: form.clientId,
        projectId: form.projectId || undefined,
        amountCents: Math.round(parseFloat(form.amount) * 100),
        dueAt: form.dueAt || undefined,
        notes: form.notes || undefined,
      });
      setCreateOpen(false);
      setForm({ clientId: '', projectId: '', amount: '', dueAt: '', notes: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
          New Invoice
        </Button>
      </div>
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {invoices === null ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-volt-text" /></div>
      ) : invoices.length === 0 ? (
        <EmptyState title="No invoices yet" hint="Create one as a draft, then send it to the client's portal." />
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Client</TH>
                <TH>Amount</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((inv) => (
                <TR key={inv.id}>
                  <TD className="font-medium text-white">{inv.number}</TD>
                  <TD className="text-neutral-400">{inv.client?.name}</TD>
                  <TD className="text-white">{money(inv.amountCents, inv.currency)}</TD>
                  <TD className="text-neutral-400">{dateStr(inv.dueAt)}</TD>
                  <TD><Badge variant={INVOICE_BADGE[inv.status]}>{inv.status}</Badge></TD>
                  <TD>
                    <div className="flex gap-2">
                      {inv.status === 'DRAFT' && (
                        <Button size="sm" variant="secondary" onClick={() => sendInvoice(inv.id).then(load).catch((e) => setError(e.message))}>
                          Send
                        </Button>
                      )}
                      {(inv.status === 'SENT' || inv.status === 'VIEWED' || inv.status === 'OVERDUE') && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setPayTarget({ id: inv.id, number: inv.number });
                            setPayReference('');
                          }}
                        >
                          Mark paid
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New invoice">
        <form onSubmit={submit} className="space-y-4">
          <Select label="Client" required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value, projectId: '' })}>
            <option value="" disabled>Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select label="Project (optional)" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
            <option value="">No project</option>
            {projects.filter((p) => p.clientId === form.clientId || p.client?.id === form.clientId).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount (USD)" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Input label="Due date" type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          </div>
          <Textarea label="Notes (client-visible)" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button type="submit" fullWidth loading={busy}>Create draft</Button>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `Mark ${payTarget.number} paid` : ''}
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">
            Records a bank-transfer payment for the full invoice amount and generates a receipt.
          </p>
          <Input
            label="Payment reference (optional)"
            value={payReference}
            onChange={(e) => setPayReference(e.target.value)}
            placeholder="e.g. wire confirmation number"
          />
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setPayTarget(null)}>
              Cancel
            </Button>
            <Button fullWidth loading={payBusy} onClick={confirmMarkPaid}>
              Mark paid
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ClientPortalView;
