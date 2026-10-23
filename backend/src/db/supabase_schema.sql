-- ==============================================================================
-- ResolveDesk: Multi-Tenant Telegram Complaint SaaS Database Schema
-- Compatible with PostgreSQL 15+ & Supabase
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. Organizations (Companies / Businesses, e.g. Flower Shop)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    subscription_tier VARCHAR(50) NOT NULL DEFAULT 'starter', -- 'starter', 'growth', 'scale', 'enterprise'
    max_bots INT NOT NULL DEFAULT 1,
    max_members INT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orgs_phone ON organizations(phone);

-- ------------------------------------------------------------------------------
-- 2. Users (Business Owner & Invited Team Members)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'agent', -- 'owner', 'admin', 'agent'
    permissions JSONB NOT NULL DEFAULT '{
        "can_reply": true,
        "can_update_status": true,
        "can_assign": false,
        "can_manage_team": false,
        "can_manage_bots": false
    }'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_phone_org UNIQUE(phone, org_id)
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- ------------------------------------------------------------------------------
-- 3. Bots (Linked Telegram Bots for each Organization)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bot_token VARCHAR(255) NOT NULL UNIQUE,
    bot_username VARCHAR(255) NOT NULL,
    bot_title VARCHAR(255),
    secret_token VARCHAR(255) NOT NULL,
    webhook_url VARCHAR(512),
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'error'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bots_org ON bots(org_id);
CREATE INDEX IF NOT EXISTS idx_bots_username ON bots(bot_username);

-- ------------------------------------------------------------------------------
-- 4. Customers (Telegram End Users who send complaints)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    telegram_user_id BIGINT NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_org_telegram UNIQUE(org_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(org_id);
CREATE INDEX IF NOT EXISTS idx_customers_telegram ON customers(telegram_user_id);

-- ------------------------------------------------------------------------------
-- 5. Complaints (Tickets)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    ticket_number VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'other', -- 'product', 'delivery', 'billing', 'service', 'other'
    priority VARCHAR(32) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'resolved', 'closed'
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ticket_number_org UNIQUE(org_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_complaints_org ON complaints(org_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON complaints(assigned_to);

-- ------------------------------------------------------------------------------
-- 6. Complaint Messages (Conversation Thread)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    sender_type VARCHAR(32) NOT NULL, -- 'customer', 'agent', 'system'
    sender_id VARCHAR(128) NOT NULL, -- customer_id or user_id
    sender_name VARCHAR(255),
    message_text TEXT NOT NULL,
    telegram_message_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_complaint ON complaint_messages(complaint_id);

-- ------------------------------------------------------------------------------
-- 7. Team Invitations
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(32) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'agent',
    permissions JSONB NOT NULL,
    invite_code VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'revoked'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(invite_code);

-- ------------------------------------------------------------------------------
-- Row Level Security (RLS) Policies for Multi-Tenancy
-- ------------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Note: In Supabase, current tenant org_id is retrieved from auth.jwt() ->> 'org_id'
-- Example policy:
-- CREATE POLICY org_isolation_policy ON complaints
--     FOR ALL
--     USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
