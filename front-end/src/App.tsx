import {Routes, Route, Outlet} from 'react-router-dom';
import {Dashboard} from "./components/Dashboard/Dashboard.tsx";
import {Config} from "./pages/config/Config.tsx";
import {ConfigDesigner} from "./pages/configDesigner/ConfigDesigner.tsx";
import {DesignerSettingsPage} from "./pages/configDesigner/DesignerSettingsPage.tsx";
import YamlEditor from "./pages/yamlEditor/YamlEditor.tsx";
import {TopologyPage} from "./pages/topology/TopologyPage.tsx";
import {HistoryPage} from "./pages/history/HistoryPage.tsx";
import {LoginPage} from "./pages/login/LoginPage.tsx";
import { Header } from "./components/Header/Header.tsx";
import { ConfigManagerProvider } from "./providers/ConfigManagerProvider.tsx";

/**
 * The signed-in console. Kept out of the login route on purpose: the provider fetches the
 * schema as soon as it mounts, which on the login page would be a guaranteed 401.
 */
function AuthenticatedLayout() {
    return (
        <ConfigManagerProvider>
            <>
                <Header />
                <Outlet />
            </>
        </ConfigManagerProvider>
    )
}

function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage/>} />
            <Route element={<AuthenticatedLayout/>}>
                <Route path="/" element={<Dashboard/>} />
                <Route path="/dashboard" element={<Dashboard/>} />
                <Route path="/config" element={<Config/>} />
                <Route path="/designer" element={<ConfigDesigner/>} />
                <Route path="/designer/settings" element={<DesignerSettingsPage/>} />
                <Route path="/yamlEditor" element={<YamlEditor/>} />
                <Route path="/topology" element={<TopologyPage/>} />
                <Route path="/history" element={<HistoryPage/>} />
            </Route>
        </Routes>
    )
}

export default App
