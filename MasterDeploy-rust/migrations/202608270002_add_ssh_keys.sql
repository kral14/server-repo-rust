-- Create ssh_keys table
CREATE TABLE IF NOT EXISTS ssh_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    private_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Alter servers table to link to ssh_keys
-- SQLite allows adding columns. In a production database, we will execute migration helper to populate ssh_keys.
-- We add ssh_key_id column first.
ALTER TABLE servers ADD COLUMN ssh_key_id TEXT REFERENCES ssh_keys(id);
