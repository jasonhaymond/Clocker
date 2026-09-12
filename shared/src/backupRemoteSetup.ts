// Generates the copy-pasteable shell commands for setting up a dedicated, restricted
// backup user on a remote Borg server — shown in both clients' Backups screen alongside
// the generated SSH key. Pure string templating (no client-specific APIs) so both clients
// render the exact same instructions from the exact same logic. Mirrors the path/
// restriction convention already documented in docs/deployment.md#the-host-agent — keep
// both in sync if either changes.

const DEFAULT_USERNAME = "clocker-backup";
const DEFAULT_REPO_PATH = "/srv/clocker-backup/repositories/clocker";

// `repoUrl` is whatever the user has typed into "Repo URL" — usually still their own
// personal login (e.g. "jason@nextcloud:/mnt/backups/clocker") until they've actually
// created the dedicated user and switched the field over to it. Parsed on a best-effort
// basis just to prefill a sensible host/path in the generated script; a local path or an
// empty field falls back to a generic placeholder host and the documented default path
// instead of guessing.
function parseSshRepoUrl(repoUrl: string | undefined): { host: string; path: string } {
  const match = (repoUrl ?? "").match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (match) return { host: match[1], path: match[2] || DEFAULT_REPO_PATH };
  return { host: "<your-server>", path: DEFAULT_REPO_PATH };
}

export function buildBackupRemoteUserScript(params: { repoUrl?: string; sshPublicKey?: string | null }): string {
  const { host, path } = parseSshRepoUrl(params.repoUrl);
  const pubKey = params.sshPublicKey?.trim() || "<paste the public key shown above>";
  const user = DEFAULT_USERNAME;

  return [
    `# Run these on the REMOTE backup server (${host}), as an admin/sudo user —`,
    `# not on this app's own server. Creates a dedicated account that can only run`,
    `# "borg serve" against one repository, so this key is useless for anything else`,
    `# even if it were ever leaked.`,
    "",
    `sudo useradd --system --create-home --home-dir /home/${user} --shell /usr/sbin/nologin ${user}`,
    `sudo mkdir -p ${path}`,
    `sudo chown ${user}:${user} ${path}`,
    `sudo mkdir -p /home/${user}/.ssh`,
    `echo 'command="borg serve --restrict-to-repository ${path}",restrict ${pubKey}' | sudo tee -a /home/${user}/.ssh/authorized_keys`,
    `sudo chown -R ${user}:${user} /home/${user}/.ssh`,
    `sudo chmod 700 /home/${user}/.ssh`,
    `sudo chmod 600 /home/${user}/.ssh/authorized_keys`,
    "",
    "# borg itself must also be installed on this remote server (borg serve needs it",
    "# there too, separately from the host running this app):",
    "sudo apt install borgbackup   # or the equivalent for this server's OS",
    "",
    "# Borg initializes the repository itself on the first backup — nothing more to",
    "# do here beyond creating the empty directory above.",
    "",
    "# Then set \"Repo URL\" above to:",
    `${user}@${host}:${path}`,
  ].join("\n");
}
