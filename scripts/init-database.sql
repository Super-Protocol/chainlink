-- Script to initialize Chainlink databases
-- This script will create databases for multiple nodes if they don't exist

-- Create databases directly (cannot use functions for CREATE DATABASE)
SELECT 'CREATE DATABASE chainlink_node_1'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chainlink_node_1')\gexec

SELECT 'CREATE DATABASE chainlink_node_2'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chainlink_node_2')\gexec

SELECT 'CREATE DATABASE chainlink_node_3'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chainlink_node_3')\gexec

SELECT 'CREATE DATABASE chainlink_node_4'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chainlink_node_4')\gexec

SELECT 'CREATE DATABASE chainlink_node_5'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chainlink_node_5')\gexec
-- Add more databases as needed
-- SELECT 'CREATE DATABASE chainlink_node_3'
-- WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chainlink_node_3')\gexec
