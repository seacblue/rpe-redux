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
  "workspace.collaboration.hostModeHint.tunnel":
    "The app will try to start Cloudflare Tunnel and generate a public invite address. This device must be able to reach Cloudflare; if startup fails, check cloudflared, the network, or security software.",
  "workspace.collaboration.hostModeHint.lan":
    "LAN hosting listens for a collaboration service on this device. Members on the same LAN can join through the local address; for access across networks, use a VPN, router port forwarding, or a tunnelling service to map this port to an address the other members can reach. Make sure the forwarding supports WebSocket, and have joiners use the mapped address and port. We do not configure NAT, firewalls, or tunnelling services for you.",
  "workspace.collaboration.connectionAddress": "Connection address",
  "workspace.collaboration.copyConnectionAddress": "Copy connection address",
  "workspace.collaboration.connectionAddressCopied": "Connection address copied.",
  "workspace.collaboration.connectionAddressCopyFailed":
    "The connection address could not be copied.",
  "workspace.collaboration.memberActions": "Member actions for {name}",
  "workspace.collaboration.changeAccess": "Change access",
  "workspace.collaboration.changeAccessTitle": "Change access for {name}",
  "workspace.collaboration.changeAccessField": "Access",
  "workspace.collaboration.changeAccessSave": "Save access",
};
