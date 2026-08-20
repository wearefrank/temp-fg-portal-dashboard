import React, { useState, useEffect } from 'react';
import { useVersionHistory, fetchVersionsForFile, checkFileExists, type VersionSummary } from '../../hooks/useVersionHistory';
import { useConfigManager } from '../../hooks/useConfigManager';
import { VersionList } from './VersionList';
import { DiffViewer } from './DiffViewer';
import {
    type FileProfile,
    type GithubSettings,
    type GitlabSettings,
    type GiteaSettings,
    type CompareSide,
} from './types';
import {
    GITHUB_STORAGE_KEY,
    GITLAB_STORAGE_KEY,
    GITEA_STORAGE_KEY,
    PROVIDER_STORAGE_KEY,
    loadGithubSettings,
    loadGitlabSettings,
    loadGiteaSettings,
    loadProvider,
    type GitProvider,
} from './gitSettingsStorage';
import { fetchGitIdentities, startGitLink, type GitIdentityMap } from '../../api/gitIdentity';
import styles from './HistoryPage.module.css';

// sentinel value used in place of a real commit sha to represent the in-memory (unsaved) state
const CURRENT_VERSION = '__current__';

// Codes Keycloak puts on the callback URL when linking fails, which read as jargon on their own.
const LINK_ERRORS: Record<string, string> = {
    not_logged_in: 'Your Keycloak session is no longer valid. Log out and back in, then try again.',
    not_allowed: 'Keycloak refused the link: your account is missing the "manage-account" role.',
    unexpected: 'That link attempt could not be verified. Please try again.',
    identity_provider_not_found: 'This provider is not configured in Keycloak.',
    unknown_identity_provider: 'This provider is not configured in Keycloak.',
};

function linkErrorMessage(code: string): string {
    return LINK_ERRORS[code] ?? `Linking failed: ${code}`;
}

function getActiveProfiles(
    provider: 'github' | 'gitlab' | 'gitea',
    github: GithubSettings,
    gitlab: GitlabSettings,
    gitea: GiteaSettings
): FileProfile[] {
    if (provider === 'gitlab') return gitlab.profiles;
    if (provider === 'gitea') return gitea.profiles;
    return github.profiles;
}

function patchProfiles<T extends { profiles: FileProfile[] }>(
    setter: React.Dispatch<React.SetStateAction<T>>,
    updater: (profiles: FileProfile[]) => FileProfile[]
): void {
    setter(prev => ({ ...prev, profiles: updater(prev.profiles) }));
}

function hasGithubRepoChanged(draft: GithubSettings, saved: GithubSettings): boolean {
    return draft.githubRepo !== saved.githubRepo
        || draft.githubBranch !== saved.githubBranch
        || JSON.stringify(draft.profiles) !== JSON.stringify(saved.profiles);
}

function hasGitlabRepoChanged(draft: GitlabSettings, saved: GitlabSettings): boolean {
    return draft.gitlabProject !== saved.gitlabProject
        || draft.gitlabBranch !== saved.gitlabBranch
        || draft.gitlabHost !== saved.gitlabHost
        || JSON.stringify(draft.profiles) !== JSON.stringify(saved.profiles);
}

function hasGiteaRepoChanged(draft: GiteaSettings, saved: GiteaSettings): boolean {
    return draft.giteaRepo !== saved.giteaRepo
        || draft.giteaBranch !== saved.giteaBranch
        || draft.giteaHost !== saved.giteaHost
        || JSON.stringify(draft.profiles) !== JSON.stringify(saved.profiles);
}

export const HistoryPage: React.FC = () => {
    const { configManager, setConfig } = useConfigManager();

    // Provider settings
    const [provider, setProvider] = useState<'github' | 'gitlab' | 'gitea'>(loadProvider);
    const [providerDraft, setProviderDraft] = useState<'github' | 'gitlab' | 'gitea'>(loadProvider);
    const [githubSettings, setGithubSettings] = useState<GithubSettings>(loadGithubSettings);
    const [githubDraft, setGithubDraft] = useState<GithubSettings>(loadGithubSettings);
    const [gitlabSettings, setGitlabSettings] = useState<GitlabSettings>(loadGitlabSettings);
    const [gitlabDraft, setGitlabDraft] = useState<GitlabSettings>(loadGitlabSettings);
    const [giteaSettings, setGiteaSettings] = useState<GiteaSettings>(loadGiteaSettings);
    const [giteaDraft, setGiteaDraft] = useState<GiteaSettings>(loadGiteaSettings);

    // File existence status keyed by file path: null = checking, true = exists, false = not found in repo
    const [fileExistsMap, setFileExistsMap] = useState<Map<string, boolean | null>>(new Map());

    // Active named file selection for the main history panel
    const [activeProfileIndex, setActiveProfileIndex] = useState(0);

    const activeProfiles = getActiveProfiles(provider, githubSettings, gitlabSettings, giteaSettings);
    const activeProfile = activeProfiles[activeProfileIndex];
    const activeFilePath = activeProfile?.filePath ?? '';
    const activeFileExists = activeFilePath ? fileExistsMap.get(activeFilePath) : undefined;

    const { versions, error, saveVersion, fetchVersionContent, loadFileContent, clearCache, refetch } = useVersionHistory(activeFilePath);
    const versionList = versions ?? [];

    // Settings panel
    const [settingsOpen, setSettingsOpen] = useState(false);

    // Keycloak account links; empty until the first fetch, which treats any failure as
    // "nothing is brokered" so the personal-access-token fields stay usable.
    const [identities, setIdentities] = useState<GitIdentityMap>({});
    const [linkError, setLinkError] = useState<string | null>(null);
    const [linking, setLinking] = useState<GitProvider | null>(null);

    // History toolbar
    const [saveFormOpen, setSaveFormOpen] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadingFile, setLoadingFile] = useState(false);
    const [pendingRestoreVersion, setPendingRestoreVersion] = useState<VersionSummary | null>(null);

    // Compare panel
    const emptySide: CompareSide = { profileIndex: 0, commitId: '', versions: null, loading: false };
    const [fromSide, setFromSide] = useState<CompareSide>(emptySide);
    const [toSide, setToSide] = useState<CompareSide>({ ...emptySide, commitId: CURRENT_VERSION });
    const [fromContent, setFromContent] = useState<string | null>(null);
    const [toContent, setToContent] = useState<string | null>(null);
    const [fromLabel, setFromLabel] = useState('');
    const [toLabel, setToLabel] = useState('');
    const [diffLoading, setDiffLoading] = useState(false);

    // --- File existence checks ---

    const checkAllProfiles = async (
        forProvider: 'github' | 'gitlab' | 'gitea',
        forGithub: GithubSettings,
        forGitlab: GitlabSettings,
        forGitea: GiteaSettings
    ) => {
        const profiles = getActiveProfiles(forProvider, forGithub, forGitlab, forGitea);
        const filePaths = profiles.map(p => p.filePath).filter(fp => !!fp);

        setFileExistsMap(prev => {
            const next = new Map(prev);
            for (const fp of filePaths) next.set(fp, null);
            return next;
        });

        await Promise.all(filePaths.map(async fp => {
            const result = await checkFileExists(fp).catch(() => null as boolean | null);
            setFileExistsMap(prev => new Map(prev).set(fp, result));
        }));
    };

    useEffect(() => {
        checkAllProfiles(provider, githubSettings, gitlabSettings, giteaSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Keycloak account links ---

    const refreshIdentities = () => fetchGitIdentities().then(setIdentities);

    // Runs before the first version fetch so a linked provider never sends a stale token.
    useEffect(() => {
        refreshIdentities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const linkAccount = async (target: GitProvider) => {
        setLinkError(null);
        setLinking(target);
        try {
            await startGitLink(target); // navigates away on success
        } catch (err) {
            setLinkError(err instanceof Error ? err.message : 'Could not start the link');
            setLinking(null);
        }
    };

    // --- Settings handlers ---

    const openSettings = () => {
        setGithubDraft(githubSettings);
        setGitlabDraft(gitlabSettings);
        setGiteaDraft(giteaSettings);
        setProviderDraft(provider);
        setSettingsOpen(true);
        checkAllProfiles(provider, githubSettings, gitlabSettings, giteaSettings);
        refreshIdentities();
    };

    // Landing spot for the link callback, which redirects back here with ?settings=1.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('settings')) return;

        const failed = params.get('linkError');
        setLinkError(failed ? linkErrorMessage(failed) : null);
        openSettings();

        // After openSettings, which resets the draft provider to the saved one.
        const linked = params.get('linked');
        if (linked === 'github' || linked === 'gitlab') setProviderDraft(linked);

        window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const cancelSettings = () => {
        setGithubDraft(githubSettings);
        setGitlabDraft(gitlabSettings);
        setGiteaDraft(giteaSettings);
        setProviderDraft(provider);
        setSettingsOpen(false);
    };

    const saveSettings = () => {
        const providerChanged = providerDraft !== provider;
        const repoChanged = providerChanged
            || (providerDraft === 'github' && hasGithubRepoChanged(githubDraft, githubSettings))
            || (providerDraft === 'gitlab' && hasGitlabRepoChanged(gitlabDraft, gitlabSettings))
            || (providerDraft === 'gitea' && hasGiteaRepoChanged(giteaDraft, giteaSettings));

        // A linked provider gets its token from Keycloak, so drop any token still sitting
        // in the browser rather than writing it back.
        const github = identities.github?.linked ? { ...githubDraft, githubToken: '' } : githubDraft;
        const gitlab = identities.gitlab?.linked ? { ...gitlabDraft, gitlabToken: '' } : gitlabDraft;

        setProvider(providerDraft);
        setGithubSettings(github);
        setGitlabSettings(gitlab);
        setGiteaSettings(giteaDraft);
        localStorage.setItem(GITHUB_STORAGE_KEY, JSON.stringify(github));
        localStorage.setItem(GITLAB_STORAGE_KEY, JSON.stringify(gitlab));
        localStorage.setItem(GITEA_STORAGE_KEY, JSON.stringify(giteaDraft));
        localStorage.setItem(PROVIDER_STORAGE_KEY, providerDraft);
        setSettingsOpen(false);

        // clamp active selection if named files were removed
        const newProfiles = getActiveProfiles(providerDraft, githubDraft, gitlabDraft, giteaDraft);
        const clampedIndex = Math.min(activeProfileIndex, Math.max(0, newProfiles.length - 1));
        setActiveProfileIndex(clampedIndex);

        if (repoChanged) {
            clearCache();
            refetch();
        }

        checkAllProfiles(providerDraft, githubDraft, gitlabDraft, giteaDraft);
    };

    // --- Named file management in settings draft ---

    const addFileToDraft = (providerKey: 'github' | 'gitlab' | 'gitea') => {
        const newFile: FileProfile = { title: 'New file', filePath: '' };
        if (providerKey === 'github') patchProfiles(setGithubDraft, ps => [...ps, newFile]);
        else if (providerKey === 'gitlab') patchProfiles(setGitlabDraft, ps => [...ps, newFile]);
        else patchProfiles(setGiteaDraft, ps => [...ps, newFile]);
    };

    const removeFileFromDraft = (providerKey: 'github' | 'gitlab' | 'gitea', idx: number) => {
        const updater = (ps: FileProfile[]) => ps.filter((_, i) => i !== idx);
        if (providerKey === 'github') patchProfiles(setGithubDraft, updater);
        else if (providerKey === 'gitlab') patchProfiles(setGitlabDraft, updater);
        else patchProfiles(setGiteaDraft, updater);
    };

    const updateFileTitle = (providerKey: 'github' | 'gitlab' | 'gitea', idx: number, title: string) => {
        const updater = (ps: FileProfile[]) => ps.map((p, i) => (i === idx ? { ...p, title } : p));
        if (providerKey === 'github') patchProfiles(setGithubDraft, updater);
        else if (providerKey === 'gitlab') patchProfiles(setGitlabDraft, updater);
        else patchProfiles(setGiteaDraft, updater);
    };

    const updateFilePath = (providerKey: 'github' | 'gitlab' | 'gitea', idx: number, filePath: string) => {
        const updater = (ps: FileProfile[]) => ps.map((p, i) => (i === idx ? { ...p, filePath } : p));
        if (providerKey === 'github') patchProfiles(setGithubDraft, updater);
        else if (providerKey === 'gitlab') patchProfiles(setGitlabDraft, updater);
        else patchProfiles(setGiteaDraft, updater);
    };

    // --- History panel handlers ---

    const handleProfileChange = (idx: number) => {
        setActiveProfileIndex(idx);
        clearCache();
    };

    const handleSaveSubmit = async () => {
        setLoadError(null);
        setSaving(true);
        try {
            await saveVersion(saveMessage, configManager.getRawText());
            setSaveFormOpen(false);
            setSaveMessage('');
            if (activeFilePath) {
                setFileExistsMap(prev => new Map(prev).set(activeFilePath, true));
            }
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleLoadFromRepo = async () => {
        setLoadError(null);
        setLoadingFile(true);
        try {
            const content = await loadFileContent();
            setFromSide({ profileIndex: activeProfileIndex, commitId: '__repo__', versions: null, loading: false });
            setToSide({ profileIndex: activeProfileIndex, commitId: CURRENT_VERSION, versions: null, loading: false });
            setFromContent(content);
            setToContent(configManager.getRawText());
            setFromLabel('Repo (HEAD)');
            setToLabel('Current (unsaved)');
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : 'Failed to load file');
        } finally {
            setLoadingFile(false);
        }
    };

    const handleRestore = (version: VersionSummary) => {
        const hasConfig = configManager.getRawText().trim().length > 0;
        if (hasConfig) {
            setPendingRestoreVersion(version);
        } else {
            confirmRestore(version);
        }
    };

    const confirmRestore = async (version: VersionSummary) => {
        setLoadError(null);
        setPendingRestoreVersion(null);
        setDiffLoading(true);
        try {
            const content = await fetchVersionContent(version.id);
            setConfig(content);
            const fromPath = activeProfiles[fromSide.profileIndex]?.filePath ?? '';
            const toPath = activeProfiles[toSide.profileIndex]?.filePath ?? '';
            if (fromSide.commitId === CURRENT_VERSION && fromPath === activeFilePath) {
                setFromContent(content);
            }
            if (toSide.commitId === CURRENT_VERSION && toPath === activeFilePath) {
                setToContent(content);
            }
        } finally {
            setDiffLoading(false);
        }
    };

    // --- Compare panel ---

    const getVersionsForSide = (side: CompareSide): VersionSummary[] => {
        if (side.versions !== null) return side.versions;
        const sidePath = activeProfiles[side.profileIndex]?.filePath ?? '';
        if (sidePath === activeFilePath) return versionList;
        return [];
    };

    const buildLabel = (side: CompareSide, commitId: string): string => {
        if (!commitId) return '';
        const profile = activeProfiles[side.profileIndex];
        const name = profile?.title ?? '';
        if (commitId === CURRENT_VERSION) return `Current (unsaved) - ${name}`;
        const vers = getVersionsForSide(side);
        const v = vers.find(x => x.id === commitId);
        const shortId = commitId.slice(0, 7);
        const msg = v?.message ? ` ${v.message}` : '';
        return `${shortId}${msg} - ${name}`;
    };

    const loadCompareDiff = async (newFrom: CompareSide, newTo: CompareSide) => {
        setFromSide(newFrom);
        setToSide(newTo);
        setFromContent(null);
        setToContent(null);

        if (!newFrom.commitId && !newTo.commitId) return;

        setDiffLoading(true);
        try {
            const fromPath = activeProfiles[newFrom.profileIndex]?.filePath ?? '';
            const toPath = activeProfiles[newTo.profileIndex]?.filePath ?? '';

            let resolvedFrom: string | null = null;
            let resolvedTo: string | null = null;

            if (newFrom.commitId === CURRENT_VERSION && fromPath === activeFilePath) {
                resolvedFrom = configManager.getRawText();
            } else if (newFrom.commitId && newFrom.commitId !== CURRENT_VERSION && newFrom.commitId !== '__repo__') {
                resolvedFrom = await fetchVersionContent(newFrom.commitId, fromPath);
            }

            if (newTo.commitId === CURRENT_VERSION && toPath === activeFilePath) {
                resolvedTo = configManager.getRawText();
            } else if (newTo.commitId && newTo.commitId !== CURRENT_VERSION && newTo.commitId !== '__repo__') {
                resolvedTo = await fetchVersionContent(newTo.commitId, toPath);
            }

            setFromContent(resolvedFrom);
            setToContent(resolvedTo);
            setFromLabel(buildLabel(newFrom, newFrom.commitId));
            setToLabel(buildLabel(newTo, newTo.commitId));
        } finally {
            setDiffLoading(false);
        }
    };

    const handleView = (version: VersionSummary) => {
        const activeSide: CompareSide = { profileIndex: activeProfileIndex, commitId: '', versions: null, loading: false };
        if (version.id === CURRENT_VERSION) {
            const latestVersion = versionList[0];
            if (!latestVersion) return;
            loadCompareDiff({ ...activeSide, commitId: latestVersion.id }, { ...activeSide, commitId: CURRENT_VERSION });
            return;
        }
        loadCompareDiff({ ...activeSide, commitId: version.id }, { ...activeSide, commitId: CURRENT_VERSION });
    };

    const handleSwapDiff = () => {
        const prevFrom = fromSide;
        setFromSide(toSide);
        setToSide(prevFrom);
        setFromContent(toContent);
        setToContent(fromContent);
        setFromLabel(toLabel);
        setToLabel(fromLabel);
    };

    const handleSideProfileChange = async (sideKey: 'from' | 'to', profileIndex: number) => {
        const newFilePath = activeProfiles[profileIndex]?.filePath ?? '';
        const updater = sideKey === 'from' ? setFromSide : setToSide;
        const contentSetter = sideKey === 'from' ? setFromContent : setToContent;
        const labelSetter = sideKey === 'from' ? setFromLabel : setToLabel;

        updater(prev => ({ ...prev, profileIndex, commitId: '', versions: null, loading: !!newFilePath }));
        contentSetter(null);
        labelSetter('');

        if (newFilePath) {
            try {
                const vers = await fetchVersionsForFile(newFilePath);
                updater(prev => ({ ...prev, versions: vers, loading: false }));
            } catch {
                updater(prev => ({ ...prev, versions: [], loading: false }));
            }
        }
    };

    const handleSideCommitChange = async (sideKey: 'from' | 'to', commitId: string) => {
        const newFrom = sideKey === 'from' ? { ...fromSide, commitId } : fromSide;
        const newTo = sideKey === 'to' ? { ...toSide, commitId } : toSide;
        await loadCompareDiff(newFrom, newTo);
    };

    // --- Render helpers ---

    const providerLabel = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : 'Gitea';
    const providerBadgeClass = provider === 'github' ? styles.providerBadgeGithub
        : provider === 'gitlab' ? styles.providerBadgeGitlab
        : styles.providerBadgeGitea;

    /**
     * Token row for a provider Keycloak can broker. Three states: linked (token lives in
     * Keycloak, no input at all), brokered but not linked yet (a Link button, with the
     * token field tucked away as a fallback), and not brokered here (just the token field,
     * exactly as before).
     */
    const renderConnection = (
        providerKey: 'github' | 'gitlab',
        label: string,
        placeholder: string,
        token: string,
        onTokenChange: (value: string) => void
    ) => {
        const identity = identities[providerKey];
        const tokenField = (
            <label className={styles.settingsLabel}>
                <span className="text-small">Personal access token</span>
                <input
                    className={styles.saveInput}
                    type="password"
                    placeholder={placeholder}
                    value={token}
                    onChange={e => onTokenChange(e.target.value)}
                />
            </label>
        );

        if (!identity?.available) {
            return tokenField;
        }

        if (identity.linked) {
            return (
                <div className={`${styles.settingsLabelFull} ${styles.connectionRow}`}>
                    <span className="text-small text-success">
                        Connected to {label}
                        {identity.username && <> as <strong>{identity.username}</strong></>}
                    </span>
                    <span className="text-muted text-small">
                        The token stays on the server. Manage or remove the link in your Keycloak account.
                    </span>
                </div>
            );
        }

        return (
            <div className={`${styles.settingsLabelFull} ${styles.connectionRow}`}>
                <div className="flex gap-sm">
                    <button
                        className="btn-primary text-small"
                        onClick={() => linkAccount(providerKey)}
                        disabled={linking === providerKey}
                    >
                        {linking === providerKey ? 'Opening Keycloak...' : `Connect ${label}`}
                    </button>
                    <span className="text-muted text-small">
                        Recommended: the token is fetched from Keycloak and never stored in your browser.
                    </span>
                </div>
                {linkError && <span className="text-small text-error">{linkError}</span>}
                <details>
                    <summary className="text-muted text-small">Use a personal access token instead</summary>
                    {tokenField}
                </details>
            </div>
        );
    };

    const renderFilesManager = (
        providerKey: 'github' | 'gitlab' | 'gitea',
        profiles: FileProfile[]
    ) => (
        <div className={styles.profilesSection}>
            <div className={styles.profilesSectionHeader}>
                <span className="text-small">Named files</span>
                <button className="text-small" onClick={() => addFileToDraft(providerKey)}>+ Add file</button>
            </div>
            {profiles.length === 0 && (
                <p className={`text-muted text-small ${styles.profilesEmpty}`}>No files yet. Add one to start tracking.</p>
            )}
            {profiles.map((profile, idx) => {
                const exists = profile.filePath ? fileExistsMap.get(profile.filePath) : undefined;
                let dotClass = '';
                if (exists === null) dotClass = styles.existsDotChecking;
                else if (exists === true) dotClass = styles.existsDotFound;
                else if (exists === false) dotClass = styles.existsDotMissing;
                const dotTitle = exists === true ? 'File found in repo' : exists === false ? 'File not found in repo' : exists === null ? 'Checking...' : '';
                return (
                    <div key={idx} className={styles.namedFileRow}>
                        <input
                            className={`${styles.saveInput} ${styles.namedFileTitleInput}`}
                            value={profile.title}
                            onChange={e => updateFileTitle(providerKey, idx, e.target.value)}
                            placeholder="Name"
                        />
                        <input
                            className={`${styles.saveInput} ${styles.namedFilePathInput}`}
                            value={profile.filePath}
                            onChange={e => updateFilePath(providerKey, idx, e.target.value)}
                            placeholder="e.g. config/apisix.yaml"
                        />
                        {dotClass
                            ? <span className={`${styles.existsDot} ${styles.existsDotSettings} ${dotClass}`} title={dotTitle} />
                            : <span className={styles.existsDotSettingsPlaceholder} />
                        }
                        <button
                            className={`text-small ${styles.profileRemoveBtn}`}
                            onClick={() => removeFileFromDraft(providerKey, idx)}
                        >
                            Remove
                        </button>
                    </div>
                );
            })}
        </div>
    );

    const renderCompareSide = (sideKey: 'from' | 'to', side: CompareSide) => {
        const sideVersions = getVersionsForSide(side);
        const sidePath = activeProfiles[side.profileIndex]?.filePath ?? '';
        const showCurrentVersion = sidePath === activeFilePath;

        return (
            <div className={styles.compareSideSelectors}>
                <select
                    className={`text-small ${styles.compareSelect}`}
                    value={side.profileIndex}
                    onChange={e => handleSideProfileChange(sideKey, Number(e.target.value))}
                    disabled={activeProfiles.length === 0}
                >
                    {activeProfiles.length === 0 && <option value={0}>(no files)</option>}
                    {activeProfiles.map((p, idx) => (
                        <option key={idx} value={idx}>{p.title}</option>
                    ))}
                </select>
                <select
                    className={`text-small ${styles.compareSelect}`}
                    value={side.commitId}
                    onChange={e => handleSideCommitChange(sideKey, e.target.value)}
                    disabled={side.loading}
                >
                    <option value="">-- version --</option>
                    {showCurrentVersion && <option value={CURRENT_VERSION}>Current (unsaved)</option>}
                    {sideVersions.map(v => (
                        <option key={v.id} value={v.id}>
                            {v.id.slice(0, 7)}{v.message ? ` ${v.message}` : ''}
                        </option>
                    ))}
                </select>
                {side.loading && <span className="text-muted text-small">Loading...</span>}
            </div>
        );
    };

    return (
        <div className={`container ${styles.page}`}>
            <div className={styles.pageHeader}>
                <h1>Version History</h1>
                <div className="flex align-center gap-sm">
                    <span className={`text-small ${styles.providerBadge} ${providerBadgeClass}`}>
                        {providerLabel}
                    </span>
                    <button
                        className="text-small"
                        onClick={() => settingsOpen ? cancelSettings() : openSettings()}
                    >
                        Settings
                    </button>
                </div>
            </div>

            {settingsOpen && (
                <div className={`card ${styles.settingsCard}`}>
                    <div className="card-header">
                        <span>Git Settings</span>
                        <div className={styles.providerTabs}>
                            <button
                                className={`text-small ${styles.providerTab} ${providerDraft === 'github' ? styles.providerTabActive : ''}`}
                                onClick={() => setProviderDraft('github')}
                            >
                                GitHub
                            </button>
                            <button
                                className={`text-small ${styles.providerTab} ${providerDraft === 'gitlab' ? styles.providerTabActive : ''}`}
                                onClick={() => setProviderDraft('gitlab')}
                            >
                                GitLab
                            </button>
                            <button
                                className={`text-small ${styles.providerTab} ${providerDraft === 'gitea' ? styles.providerTabActive : ''}`}
                                onClick={() => setProviderDraft('gitea')}
                            >
                                Gitea
                            </button>
                        </div>
                    </div>

                    {providerDraft === 'github' && (
                        <div className={styles.settingsFields}>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Repository</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="owner/repo or https://github.com/owner/repo"
                                    value={githubDraft.githubRepo}
                                    onChange={e => setGithubDraft(prev => ({ ...prev, githubRepo: e.target.value }))}
                                />
                            </label>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Branch</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="e.g. main"
                                    value={githubDraft.githubBranch}
                                    onChange={e => setGithubDraft(prev => ({ ...prev, githubBranch: e.target.value }))}
                                />
                            </label>
                            {renderConnection(
                                'github',
                                'GitHub',
                                'ghp_...',
                                githubDraft.githubToken,
                                value => setGithubDraft(prev => ({ ...prev, githubToken: value }))
                            )}
                            <div className={styles.settingsLabelFull}>
                                {renderFilesManager('github', githubDraft.profiles)}
                            </div>
                        </div>
                    )}

                    {providerDraft === 'gitlab' && (
                        <div className={styles.settingsFields}>
                            <label className={`${styles.settingsLabel} ${styles.settingsLabelFull}`}>
                                <span className="text-small">Instance URL</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="https://gitlab.com"
                                    value={gitlabDraft.gitlabHost}
                                    onChange={e => setGitlabDraft(prev => ({ ...prev, gitlabHost: e.target.value }))}
                                />
                            </label>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Project path</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="owner/project"
                                    value={gitlabDraft.gitlabProject}
                                    onChange={e => setGitlabDraft(prev => ({ ...prev, gitlabProject: e.target.value }))}
                                />
                            </label>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Branch</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="e.g. main"
                                    value={gitlabDraft.gitlabBranch}
                                    onChange={e => setGitlabDraft(prev => ({ ...prev, gitlabBranch: e.target.value }))}
                                />
                            </label>
                            {renderConnection(
                                'gitlab',
                                'GitLab',
                                'glpat-...',
                                gitlabDraft.gitlabToken,
                                value => setGitlabDraft(prev => ({ ...prev, gitlabToken: value }))
                            )}
                            <div className={styles.settingsLabelFull}>
                                {renderFilesManager('gitlab', gitlabDraft.profiles)}
                            </div>
                        </div>
                    )}

                    {providerDraft === 'gitea' && (
                        <div className={styles.settingsFields}>
                            <label className={`${styles.settingsLabel} ${styles.settingsLabelFull}`}>
                                <span className="text-small">Instance URL</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="https://gitea.example.com"
                                    value={giteaDraft.giteaHost}
                                    onChange={e => setGiteaDraft(prev => ({ ...prev, giteaHost: e.target.value }))}
                                />
                            </label>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Repository</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="owner/repo"
                                    value={giteaDraft.giteaRepo}
                                    onChange={e => setGiteaDraft(prev => ({ ...prev, giteaRepo: e.target.value }))}
                                />
                            </label>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Branch</span>
                                <input
                                    className={styles.saveInput}
                                    type="text"
                                    placeholder="e.g. main"
                                    value={giteaDraft.giteaBranch}
                                    onChange={e => setGiteaDraft(prev => ({ ...prev, giteaBranch: e.target.value }))}
                                />
                            </label>
                            <label className={styles.settingsLabel}>
                                <span className="text-small">Access token</span>
                                <input
                                    className={styles.saveInput}
                                    type="password"
                                    placeholder="your-gitea-token"
                                    value={giteaDraft.giteaToken}
                                    onChange={e => setGiteaDraft(prev => ({ ...prev, giteaToken: e.target.value }))}
                                />
                            </label>
                            <div className={styles.settingsLabelFull}>
                                {renderFilesManager('gitea', giteaDraft.profiles)}
                            </div>
                        </div>
                    )}

                    <div className={styles.settingsFooter}>
                        <span className="text-muted text-small">Repository settings are saved in your browser only. So are personal access tokens - connect through Keycloak instead to keep them off this device.</span>
                        <div className="flex gap-sm">
                            <button className="btn-primary text-small" onClick={saveSettings}>Save Settings</button>
                            <button className="text-small" onClick={cancelSettings}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.layout}>
                <div className={`card flex flex-column ${styles.leftPanel}`}>
                    <div className="card-header">
                        <span>Version History</span>
                    </div>

                    {activeProfiles.length === 0 ? (
                        <div className={`text-muted text-small ${styles.statusMsg}`}>
                            No files configured. Open Settings to add one.
                        </div>
                    ) : (
                        <>
                            <div className={styles.profileSelector}>
                                {activeProfiles.map((p, idx) => {
                                    const exists = p.filePath ? fileExistsMap.get(p.filePath) : undefined;
                                    let dotClass = '';
                                    if (exists === null) dotClass = styles.existsDotChecking;
                                    else if (exists === true) dotClass = styles.existsDotFound;
                                    else if (exists === false) dotClass = styles.existsDotMissing;
                                    const dotTitle = exists === true ? 'File found in repo' : exists === false ? 'File not found in repo' : exists === null ? 'Checking...' : '';
                                    return (
                                        <button
                                            key={idx}
                                            className={`text-small ${styles.profilePill} ${idx === activeProfileIndex ? styles.profilePillActive : ''}`}
                                            onClick={() => handleProfileChange(idx)}
                                        >
                                            {dotClass && <span className={`${styles.existsDot} ${dotClass}`} title={dotTitle} />}
                                            {p.title}
                                        </button>
                                    );
                                })}
                                {activeProfile && !activeProfile.filePath && (
                                    <span className="text-muted text-small">No path set for this file.</span>
                                )}
                            </div>

                            <div className={styles.toolbar}>
                                <button
                                    className="btn-primary text-small"
                                    onClick={() => setSaveFormOpen(open => !open)}
                                    disabled={!activeFilePath}
                                >
                                    Commit
                                </button>
                                <button
                                    className="text-small"
                                    onClick={handleLoadFromRepo}
                                    disabled={loadingFile || !activeFilePath}
                                >
                                    {loadingFile ? 'Loading...' : 'Load from repo'}
                                </button>
                            </div>

                            {activeFileExists === false && !saveFormOpen && (
                                <div className={styles.fileNotFoundBanner}>
                                    <span className="text-small">This file does not exist in the repository yet.</span>
                                    <button
                                        className="btn-primary text-small"
                                        onClick={() => {
                                            const name = activeProfile?.filePath?.split('/').pop() ?? 'file';
                                            setSaveMessage(`Initialize ${name}`);
                                            setSaveFormOpen(true);
                                        }}
                                    >
                                        Create file
                                    </button>
                                </div>
                            )}

                            {loadError && (
                                <div className={`text-error text-small ${styles.statusMsg}`}>{loadError}</div>
                            )}

                            {saveFormOpen && (
                                <div className={styles.saveForm}>
                                    <span className="text-muted text-small">This will create a git commit in the configured repository.</span>
                                    <input
                                        type="text"
                                        placeholder="Commit message..."
                                        value={saveMessage}
                                        onChange={e => setSaveMessage(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSubmit(); }}
                                        className={styles.saveInput}
                                        autoFocus
                                    />
                                    <div className="flex gap-sm">
                                        <button
                                            className="btn-primary text-small"
                                            onClick={handleSaveSubmit}
                                            disabled={saving}
                                        >
                                            {saving ? 'Committing...' : 'Commit'}
                                        </button>
                                        <button className="text-small" onClick={() => { setSaveFormOpen(false); setSaveMessage(''); }}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}

                            {error && <div className={`text-error text-small ${styles.statusMsg}`}>
                                {error}
                            </div>}

                            <VersionList
                                versions={[{ id: CURRENT_VERSION, message: 'Current (unsaved)', createdAt: '' }, ...versionList]}
                                currentSentinel={CURRENT_VERSION}
                                loading={versions === null && !!activeFilePath}
                                busy={diffLoading}
                                pendingRestoreId={pendingRestoreVersion?.id}
                                onView={handleView}
                                onRestore={handleRestore}
                                onConfirmRestore={confirmRestore}
                                onCancelRestore={() => setPendingRestoreVersion(null)}
                            />
                        </>
                    )}
                </div>

                <div className={`card flex flex-column ${styles.rightPanel}`}>
                    <div className={`card-header ${styles.compareHeader}`}>
                        <div className={styles.compareHeaderRow}>
                            <span>Compare</span>
                            {diffLoading && <span className={`text-muted text-small ${styles.loadingIndicator}`}>Loading...</span>}
                            <button className={`text-small ${styles.swapBtn}`} onClick={handleSwapDiff} title="Swap direction">⇄</button>
                        </div>
                        <div className={styles.compareSidesRow}>
                            {renderCompareSide('from', fromSide)}
                            <span className={`text-muted text-small ${styles.compareArrow}`}>→</span>
                            {renderCompareSide('to', toSide)}
                        </div>
                    </div>

                    <div className={styles.diffArea}>
                        <DiffViewer
                            fromContent={fromContent}
                            toContent={toContent}
                            fromLabel={fromLabel}
                            toLabel={toLabel}
                            loading={diffLoading}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
