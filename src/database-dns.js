import { setServers } from 'node:dns';
import { isIP } from 'node:net';
// Process-local override for networks whose DNS blocks MongoDB Atlas SRV lookups.
export function configureMongoDns() {
  if (!process.env.MONGODB_DNS_SERVERS) return;
  const servers = process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim());
  if (!servers.length || servers.some(value => !isIP(value))) throw new Error('MONGODB_DNS_SERVERS must contain comma-separated DNS server IP addresses.');
  setServers(servers);
}
