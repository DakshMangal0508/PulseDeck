# PulseDeck Plan

## Goal

Make PulseDeck easy to open on a Windows PC and use from a phone on the same Wi-Fi. The PC runs the existing backend and dashboard; the phone discovers and pairs with the PC without requiring the user to manage changing IP addresses.

## What we are doing

1. **Build the Windows app with Tauri v2.** Keep PulseDeck controls in the main area and show the connected phone in a left sidebar with its pairing state, available status, and wallpaper preview.
2. **Make app startup reliable.** Let users optionally open the desktop app with Windows and show clear running status. The current task starts only the backend; it will be replaced or updated to launch the app.
3. **Finish local pairing in this order.** Keep QR pairing as the simplest setup. Support Wi-Fi pairing with QR or a copied link. Build direct USB cable communication between the Windows app and Android companion app; do not require USB tethering. Then add Bluetooth through the native phone app and a Windows Bluetooth transport.
4. **Build the Android phone app.** Add discovery, pairing, reconnect, and touch-friendly PulseDeck controls. Share battery and available connectivity details with clear permission; let the user choose a wallpaper image to show in the Windows sidebar. Bluetooth depends on this app.

## Working workflow

For each step, make one focused change, verify it in the real Windows or phone environment, and update the setup notes. Pairing checks should cover both devices on the same Wi-Fi, app restarts, and a changed PC network address.

## Current state

- The FastAPI backend and React dashboard exist and run on Windows.
- The Windows sign-in task currently starts the backend from this checkout. The Tauri v2 app has been built and installed for the current Windows user.
- The Windows connection dialog offers QR, Wi-Fi link, direct USB, and Bluetooth. QR and Wi-Fi use the existing local network pairing. Direct USB and Bluetooth are clearly marked as planned until the Android app and Windows transports exist. USB tethering is not part of the product plan.
- Automatic local discovery and reconnect after an IP change are not implemented yet.
- The Windows sidebar now shows paired-phone status, available device detail placeholders, and the pairing QR beside the PulseDeck controls. Device status needs the native phone app; wallpaper will be user-shared from that app.
- The standalone phone app is not present yet.
