# StudyDash React skin

Student dashboard for choosing the next assignment and keeping study tools close.
Energy 2 / Rhythm 2 / Motion 2.

- Black background with white text and accent gives the new default the requested monochrome identity.
- Existing saved theme, font and color preferences remain the source of appearance tokens.
- The local shadcn-vue Reka Nova controls supply the compact spacing, rounded corners and semantic surfaces.
- The radial-text chart uses the shadcn React implementation and the real completed/total task count. No sample visitor data or trend claims are displayed.
- Study uses the supplied React DotPattern component with a slow diagonal wave and pointer glow. The quiet, accent-colored dots provide the requested ambient study texture while the brighter timer stays dominant. The field pauses when hidden, when Pause background is selected, or with reduced motion. Pointer glow stays behind the timer and tools.
- Motion React adds short button feedback and page transitions to help the eye follow input. Persistent decoration stays still outside Study.

The Vue reference is used for skin direction. The runnable components use React, shadcn/ui, Recharts and Motion.
Source licenses for the Vue and Vengeance references are in licenses/.

The sidebar's moving selection, button ripples, startup word flips and timer breathing are local implementations of the requested interactions. Some shadcn.io registry endpoints require authenticated access, and Breathing Text is listed as Pro. These local effects do not claim to include those gated component sources. Dialog is the public shadcn/Radix component, connected to the existing task/import forms and asynchronous confirmations.

The timer animation can be disabled in Study settings and is saved in the existing study preferences. General reduced-motion settings also disable it. Motion does not change timer arithmetic.

Ripple buttons default to the compact small variant, 32px on desktop with larger touch targets for coarse pointers. Announcements, opportunity status/kind and task-source filters use the same React component and preserve their native filtering logic, counts and keyboard focus. Selected buttons use the saved accent.

Selected source filters keep their accent background on hover. The legacy hover selector now uses the actual aria-pressed state, so it cannot replace an active button's background while leaving dark text behind. Selected counts use full text opacity.

Task rings and category chips default to the accent, including assignments from school integrations. Routines contains category color defaults and optional per-routine overrides. The task form offers Automatic or Custom. Inheritance is task override, routine override, category override, then the live accent. Automatic stores no fixed color, so future personalization changes remain connected. Opportunity tags and summary dots use the Opportunity category color with the same accent fallback. Checkbox check marks use contrasting ink.

Startup uses a local React Starfield effect based on the linked example's documented appearance. The linked install requires sign-in, so its exact source was not installed. Deterministically placed particles fly outward using CSS transforms and opacity, with a faint distant layer. All particles inherit the live accent. Smaller containers display fewer moving particles. Returning-user startup lasts 20 seconds and can be dismissed with physical Enter or Start. Pause and reduced motion keep the particles still. First-time name setup retains its required name field.

Source-filter dots summarize the colors already assigned to their tasks. The first task/routine override in a source takes priority, followed by its first configured category color, the source's associated category, and the live accent. This lets routine choices override the default accent. A thin text-colored outline keeps the marker visible when its fill matches the selected button's background.

The shared dialog explicitly has one column. This prevents the legacy dashboard's global grid class from adding an empty second column. Task forms fill a centered 520px panel with equal padding, scrolling on short viewports and single-column field rows on narrow screens.

The supplied Notebook & pen PNGs are retained in assets. Dark mode uses the white-paper variant, light mode the black-paper variant. Canvas recolors the paper using the saved accent and chooses readable pen ink while retaining the original page shading. The same rendering updates the brand, caption, startup screen, favicon, desktop window and tray. The desktop saves themed icons in the existing app data directory.
