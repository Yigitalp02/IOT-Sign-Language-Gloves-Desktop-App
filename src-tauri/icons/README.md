# Application Icons

## Quick Setup

Tauri requires app icons in multiple sizes. You have two options:

### Option 1: Auto-generate from a PNG (Recommended)

1. Create or download a 1024x1024 PNG icon (e.g., `icon.png`)
2. Run the Tauri icon generator:
   ```bash
   pnpm tauri icon path/to/icon.png
   ```
3. Icons will be automatically generated in all required sizes

### Option 2: Use Placeholders (For Quick Demo)

For a quick demo, Tauri will use default icons. You can replace them later.

## Required Icon Sizes

- `32x32.png` - Windows taskbar
- `128x128.png` - macOS app icon (standard)
- `128x128@2x.png` - macOS app icon (retina)
- `icon.icns` - macOS bundle icon
- `icon.ico` - Windows executable icon
- `Square*` (Windows only) - UWP app tiles

## Icon Design Tips

- Use a simple, recognizable symbol (e.g., hand gesture, sign language "I love you" 🤟)
- Ensure good contrast and visibility at small sizes
- Avoid text (hard to read when scaled down)
- Use transparent background for non-rectangular icons
- Test on both light and dark backgrounds

## Free Icon Resources

- **Flaticon**: https://www.flaticon.com/free-icons/sign-language
- **Icons8**: https://icons8.com/icons/set/hand
- **Noun Project**: https://thenounproject.com/search/?q=sign+language

## Creating Your Own Icon

Use any of these tools:
- **Figma** (free, web-based): https://figma.com
- **GIMP** (free, desktop): https://www.gimp.org/
- **Photoshop** (paid)

Save as PNG with transparent background, 1024x1024px minimum.

---

**For now**: The app will work fine with Tauri's default icons. Replace them before your final presentation! 🎨

