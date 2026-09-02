import { useCallback, useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import { useConfigManager } from '../../hooks/useConfigManager';
import { client } from '../../api/client';
import { logout } from '../../api/auth';
import styles from './Header.module.css';

type Status = 'ok' | 'error' | 'checking';

interface CurrentUser {
  name?: string;
  roles?: string[];
  groups?: string[];
}

const StatusDot = ({ status, label }: { status: Status; label: string }) => (
  <div className={styles.indicator}>
    <span className={
      status === 'ok'    ? 'text-success' :
      status === 'error' ? 'text-error'   :
                           ''
    }>{label}</span>
  </div>
);

export const Header = () => {
  const { fetchSchema } = useConfigManager();
  const [schemaStatus, setSchemaStatus]   = useState<Status>('checking');
  const [controlStatus, setControlStatus] = useState<Status>('checking');
  const [metricsStatus, setMetricsStatus] = useState<Status>('checking');
  const [user, setUser] = useState<CurrentUser | null>(null);

  const doFetch = useCallback(() => {
    Promise.allSettled([
      fetchSchema(),
      client<boolean>('/config/check?api=control', { method: 'GET' }),
      client<boolean>('/config/check?api=metrics', { method: 'GET' }),
    ]).then(([schema, control, metrics]) => {
      setSchemaStatus(schema.status   === 'fulfilled'                    ? 'ok' : 'error');
      setControlStatus(control.status === 'fulfilled' && control.value   ? 'ok' : 'error');
      setMetricsStatus(metrics.status === 'fulfilled' && metrics.value   ? 'ok' : 'error');
    });
  }, [fetchSchema]);

  const checkConnections = useCallback(() => {
    setSchemaStatus('checking');
    setControlStatus('checking');
    setMetricsStatus('checking');
    doFetch();
  }, [doFetch]);

  useEffect(() => { doFetch(); }, [doFetch]);

  useEffect(() => {
    client<CurrentUser>('/user', { method: 'GET' })
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const isChecking = schemaStatus === 'checking' || controlStatus === 'checking' || metricsStatus === 'checking';

  // Groups only show when the IdP maps a "groups" claim, so both parts are optional.
  const roles = user?.roles?.join(', ') ?? '';
  const groups = user?.groups?.join(', ') ?? '';

  return (
    <header className={styles.appHeader}>
      <div className={`container ${styles.headerInner}`}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandAccent}>Frank<b>!</b></span>Gateway
        </Link>

        <nav className={styles.navLinks}>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Dashboard
          </NavLink>
          {/*<NavLink to="/yamlEditor" className={({ isActive }) => (isActive ? 'active' : undefined)}>*/}
          {/*  YAML Editor*/}
          {/*</NavLink>*/}
          {/*<NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : undefined)}>*/}
          {/*  History*/}
          {/*</NavLink>*/}
          {/*<NavLink to="/config" className={({ isActive }) => (isActive ? 'active' : undefined)}>*/}
          {/*  Config*/}
          {/*</NavLink>*/}
          {/*<NavLink to="/designer" className={({ isActive }) => (isActive ? 'active' : undefined)}>*/}
          {/*  Config Designer*/}
          {/*</NavLink>*/}
          {/*<NavLink to="/topology" className={({ isActive }) => (isActive ? 'active' : undefined)}>*/}
          {/*  Topology*/}
          {/*</NavLink>*/}
        </nav>

        <div className={styles.headerActions}>
        {/*  <div className={styles.statusIndicators}>*/}
        {/*    <StatusDot status={schemaStatus}  label="Schema"  />*/}
        {/*    <StatusDot status={controlStatus} label="Control" />*/}
        {/*    <StatusDot status={metricsStatus} label="Metrics" />*/}
        {/*  </div>*/}
        {/*  <button*/}
        {/*    onClick={checkConnections}*/}
        {/*    disabled={isChecking}*/}
        {/*    className={isChecking ? '' : 'btn-primary'}*/}
        {/*  >*/}
        {/*    {isChecking ? 'Checking...' : 'Retry'}*/}
        {/*  </button>*/}
          <ThemeToggle />
        </div>
      </div>

      <div className={styles.userCorner}>
        <div className={styles.userSummary} tabIndex={0}>
          <span className={styles.userName}>{user?.name ?? 'Unknown user'}</span>
          {/*{roles && <span className={styles.userRole}>{roles}</span>}*/}

          {/*{(roles || groups) && (*/}
          {/*  <div className={styles.userDetails} role="tooltip">*/}
          {/*    {roles && (*/}
          {/*      <div className={styles.detailRow}>*/}
          {/*        <span className={styles.detailLabel}>Roles</span>*/}
          {/*        <span>{roles}</span>*/}
          {/*      </div>*/}
          {/*    )}*/}
          {/*    {groups && (*/}
          {/*      <div className={styles.detailRow}>*/}
          {/*        <span className={styles.detailLabel}>Groups</span>*/}
          {/*        <span>{groups}</span>*/}
          {/*      </div>*/}
          {/*    )}*/}
          {/*  </div>*/}
          {/*)}*/}
        </div>

        <button onClick={logout} className={styles.logoutButton}>Log out</button>
      </div>
    </header>
  );
};
