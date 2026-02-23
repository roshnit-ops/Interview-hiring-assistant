# Google Calendar + Google Meet: What’s Possible

## What we added: Calendar integration

- **Connect Google Calendar** (OAuth) so the app can read your upcoming events.
- **List meetings** that have a **Google Meet link** (today / next 7 days).
- **“Start evaluation for this meeting”** in the app:
  - Opens the **Meet link in a new tab** (you join the call there).
  - Starts the **evaluation in this tab** (mic + transcript + scoring).
- So: **you** still join the call in the Meet tab; **this app** runs in another tab and captures the call via your **microphone** (same as today). The only change is you pick the meeting from Calendar and we open the right Meet link for you.

## Can the app “join” the call and get the live transcript by itself?

**Not with the current setup.**

- **Google Meet** does not offer a simple public API for a “bot” to join a meeting and receive the audio/transcript. Your app cannot join the call in your place and pull the stream.
- **Google Meet Media API** (Google’s official way to get meeting media) exists but is **restricted** (workspace/enterprise, OAuth with limited scopes, verification, WebRTC). It’s not a one-click integration for a typical side project.
- **Third‑party “meeting bot” services** (e.g. **Recall.ai**, **Fireflies**) can join Meet (and Zoom, etc.) as a bot and give you audio/transcript via their API. That would mean:
  - Using their API instead of (or in addition to) your current “browser + mic” flow.
  - Their bot joins the meeting; you get transcript/audio from them and then run your evaluation steps (e.g. send transcript to Grok, email report).  
  That’s the way to get “the app joins the call and gets the live transcript from the call” without you being in the call.

## Summary

| Goal | Possible? | How |
|------|-----------|-----|
| See your Google Calendar meetings in the app | Yes | Calendar OAuth + list events (we added this). |
| Open the Meet link and start evaluation in one click | Yes | “Start evaluation for this meeting” opens Meet in a new tab and starts mic + evaluation here. |
| App joins the Meet by itself and gets live transcript | No (with our code only) | You join Meet; app uses your mic. For true bot join + transcript, use a service like Recall.ai. |

So: **you can connect Google Calendar**, pick a meeting, and have the app open that meeting and run the rest of the steps (live transcript from the call via your mic). The app does **not** join the call itself; it works by you joining in one tab and the app capturing in another.

If you want, we can next add the **Calendar connection** in the app (OAuth, list events with Meet links, “Start evaluation for this meeting” button and flow).
