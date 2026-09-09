-- MasterDeploy Multi-Node Server Plugins and Flexible Tunnels Migration

-- 1. Server Plugins Table: Tracks plugin installations per server (e.g. cloudflare, sccache)
CREATE TABLE IF NOT EXISTS server_plugins (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    plugin_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'installed',
    config_json TEXT,
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, plugin_name)
);

-- 2. Tunnels Table: Manages individual or shared tunnels on a specific server
CREATE TABLE IF NOT EXISTS tunnels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tunnel_type TEXT NOT NULL DEFAULT 'dedicated', -- 'shared' or 'dedicated'
    public_url TEXT,
    status TEXT NOT NULL DEFAULT 'stopped', -- 'active', 'starting', 'stopped', 'error'
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, name)
);

-- 3. Tunnel Routes Table: Maps applications/ports to a tunnel
CREATE TABLE IF NOT EXISTS tunnel_routes (
    id TEXT PRIMARY KEY,
    tunnel_id TEXT NOT NULL REFERENCES tunnels(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    target_port INTEGER NOT NULL,
    route_path TEXT NOT NULL DEFAULT '/',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tunnel_id, app_id)
);

-- Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_server_plugins_server ON server_plugins(server_id);
CREATE INDEX IF NOT EXISTS idx_server_plugins_lookup ON server_plugins(server_id, plugin_name);
CREATE INDEX IF NOT EXISTS idx_tunnels_server ON tunnels(server_id);
CREATE INDEX IF NOT EXISTS idx_tunnel_routes_tunnel ON tunnel_routes(tunnel_id);
CREATE INDEX IF NOT EXISTS idx_tunnel_routes_app ON tunnel_routes(app_id);
