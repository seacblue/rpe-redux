/**
 * Room setup progress copy for the workspace collaboration dialog.
 *
 * The progress surface is a modal peer of the editor, so its text lives beside
 * the other workspace catalogs rather than inside the room panel namespace.
 */
export default {
  "workspace.collaboration.progress.hostTitle": "Creating the room",
  "workspace.collaboration.progress.guestTitle": "Joining the room",
  "workspace.collaboration.progress.title": "Room setup progress",
  "workspace.collaboration.progress.status.preparing": "Preparing the chart",
  "workspace.collaboration.progress.status.bridgeTunnel": "Starting Cloudflare Tunnel",
  "workspace.collaboration.progress.status.bridgeLan": "Starting the LAN bridge",
  "workspace.collaboration.progress.status.tunnelResolve": "Locating the Cloudflare Tunnel client",
  "workspace.collaboration.progress.status.tunnelStart": "Starting cloudflared",
  "workspace.collaboration.progress.status.tunnelWait":
    "Waiting for the public trycloudflare.com address",
  "workspace.collaboration.progress.status.tunnelReady": "Tunnel address received",
  "workspace.collaboration.progress.status.tunnelReuse": "Reusing the active tunnel",
  "workspace.collaboration.progress.status.tunnelError": "The tunnel could not start",
  "workspace.collaboration.progress.status.connect": "Connecting to the room service",
  "workspace.collaboration.progress.status.waiting": "Waiting for host approval",
  "workspace.collaboration.progress.status.chart": "Downloading the chart",
  "workspace.collaboration.progress.status.assets": "Downloading room files",
  "workspace.collaboration.progress.status.audio": "Downloading audio",
  "workspace.collaboration.progress.status.background": "Downloading background image",
  "workspace.collaboration.progress.status.publish": "Publishing the chart and assets",
  "workspace.collaboration.progress.status.ready": "Room ready",
  "workspace.collaboration.progress.aborted": "Room setup was aborted.",
  "workspace.collaboration.memberActions": "Member actions for {name}",
  "workspace.collaboration.changeAccess": "Change access",
  "workspace.collaboration.changeAccessTitle": "Change access for {name}",
  "workspace.collaboration.changeAccessField": "Access",
  "workspace.collaboration.changeAccessSave": "Save access",
};
