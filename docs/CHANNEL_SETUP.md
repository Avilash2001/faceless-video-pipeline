# Channel setup: from nothing to auto-posting

A checklist for creating the YouTube, Instagram and Facebook accounts this pipeline publishes to, and for filling every publishing value in `.env`. Written for a solo creator in India.

- **Sources checked 2026-10-24.** Help-center pages show no date unless one is quoted.
- **[UNVERIFIED]** marks a step taken from the current UI or third-party reports that I couldn't confirm in an official doc. Menu labels change often.
- Never commit `.env`. These tokens give full posting access to your accounts.

---

## 0. Before you start

1. Pick one brand name and check that the handle is free on all three platforms.
2. Turn on **2-Step Verification** for the Google account. YPP requires it ([YPP eligibility](https://support.google.com/youtube/answer/72851)).
3. Use your real personal Facebook profile. Pages and developer apps belong to a real person.
4. Have a mobile number ready for YouTube verification. One number can verify at most 2 channels ([source](https://support.google.com/youtube/answer/9891124)).

---

## Part A: YouTube channel

1. **Create a Brand Account channel.** It can use a name different from your Google name and can have several managers ([Create a channel](https://support.google.com/youtube/answer/1646861)).
   Path: YouTube → profile picture → **Settings** → **Add or manage channel(s)** → **Create a new channel** → picture, name, handle → **Create channel**.
2. **Handle:** 3–30 characters. Letters, numbers, `_`, `-` and `.` are allowed, but not at the start or end ([Handles](https://support.google.com/youtube/answer/11585688)).
3. **Branding** (Studio → **Customization** → **Profile**) ([specs](https://support.google.com/youtube/answer/10456525)):
   - Profile picture: square JPG or PNG, 15 MB or less, displayed at 98×98. Upload 800×800.
   - Banner: at least 2048×1152, 2560×1440 recommended, 6 MB or less. Keep text inside the central 1235×338 area.
4. **Description:** 2–3 lines on what viewers get, plus "visuals and narration are AI-assisted". I couldn't confirm the length limit **[UNVERIFIED: commonly 1,000 chars]**.
5. **Phone verification:** Studio → **Settings** → **Channel** → **Feature eligibility** → **Intermediate features** → **Verify phone number** ([source](https://support.google.com/youtube/answer/9891124)).
   - This unlocks custom thumbnails, videos longer than 15 minutes and live streaming.
   - *Advanced* features come from channel history or ID/video verification: higher daily upload limits, clickable links, pinned comments, and applying for monetization ([source](https://support.google.com/youtube/answer/9890437)).
   - New channels start with a "limited daily" upload allowance.
6. **Upload defaults** (Studio → **Settings** → **Upload defaults**) apply **only to uploads made in the browser at youtube.com/upload** ([source](https://support.google.com/youtube/answer/2660027)). The pipeline sets its own title, tags, category 27, privacy and "not made for kids" in `src/services/publisher.ts`.
7. **AI disclosure:** in the Studio upload flow, answer the **"AI use"** question in the **Attributes** section ([Altered or synthetic content](https://support.google.com/youtube/answer/14328491)).
   - It's required for *realistic* AI content.
   - It's not required for clearly animated or fantastical content, or for AI-assisted scripts.
   - Disclosing does not reduce reach or monetization.
   - The API field is `status.containsSyntheticMedia` ([videos resource](https://developers.google.com/youtube/v3/docs/videos), updated 2026-10-15). The pipeline already sends `true`, which is the safe default.
8. **Monetization thresholds.** India is eligible for full YPP ([countries](https://support.google.com/youtube/answer/7101720)) and for the lower tier ([expanded YPP](https://support.google.com/youtube/answer/13429240)).

| Tier | Requirement | Unlocks |
|---|---|---|
| Expanded (fan funding) | 500 subs + 3 public uploads in 90 days + (3,000 watch hrs in 12 months **or** 3M Shorts views in 90 days) | Memberships, Super Thanks, Shopping |
| Full YPP, until 31 Jan 2027 | 1,000 subs + (4,000 long-form hrs in 12 months **or** 10M Shorts views in 90 days) | Ad revenue share |
| Full YPP, new applicants from 1 Feb 2027 | 1,000 subs + (**8,000** hrs **or** **20M** Shorts views in 90 days) | Ad revenue share. Shorts revenue also needs 10M Shorts views in 90 days |

Sources for the 2027 row: [YouTube blog, 10 Aug 2026](https://blog.youtube/news-and-events/youtube-partner-program-updates-2027-new-opportunities-earn/) and [YPP updates](https://support.google.com/youtube/answer/12843009). The fan-funding tier is unchanged.

> **YouTube gotchas**
> - **"Inauthentic content" policy (since 15 Jul 2025):** YouTube won't monetize content that is "interchangeable", templated, or "AI-generated content built on generic or unoriginal templates" ([monetization policies](https://support.google.com/youtube/answer/1311392)). This is the main risk for a pipeline channel. Every video needs a distinct story with real narrative value.
> - Shorts are vertical videos up to 3 minutes ([source](https://support.google.com/youtube/answer/10059070)). The `#Shorts` tag is optional.
> - Links in the credit and source lines aren't clickable until you have advanced features.

---

## Part B: Google Cloud (YouTube API uploads)

1. **Create a project:** [console.cloud.google.com](https://console.cloud.google.com) → project picker → **New project**.
2. **Enable the APIs:** **APIs & Services** → **Library** → enable **YouTube Data API v3** and **YouTube Analytics API**.
3. **Set up the consent screen in Google Auth Platform.** The old "OAuth consent screen" menu now opens it.
   - **Branding:** app name and support email **[UNVERIFIED labels]**.
   - **Audience:** **External**. Under **Test users**, add your Gmail. In *Testing*, only test users can sign in, up to 100 ([Manage audience](https://support.google.com/cloud/answer/15549945)).
   - **Data Access:** add `youtube.upload` and `yt-analytics.readonly` **[UNVERIFIED label]**.
4. **Create the client:** **Google Auth Platform → Clients → Create client** → **Web application** ([Manage OAuth clients](https://support.google.com/cloud/answer/15549257)).
   - Under **Authorized redirect URIs**, add `https://developers.google.com/oauthplayground`.
   - Click **Create**. Copy the ID to `YOUTUBE_CLIENT_ID` and the secret to `YOUTUBE_CLIENT_SECRET`.
5. **Publish the app before you create the refresh token:** **Audience → Publish app**.
   - A project in *Testing* "is issued a refresh token expiring in 7 days" ([OAuth 2.0 docs](https://developers.google.com/identity/protocols/oauth2#expiration), updated 2026-10-16).
   - Apps for "personal use (fewer than 100 users)" don't need verification. You click through the "unverified app" warning instead ([When verification is not needed](https://support.google.com/cloud/answer/13464323)).
   - **[UNVERIFIED, widely reported]** Tokens created while the app was in Testing keep the 7-day expiry, so create a new one after publishing.
6. **Get the refresh token** with the [OAuth Playground](https://developers.google.com/oauthplayground):
   1. Gear icon → tick **Use your own OAuth credentials** → paste your client ID and secret.
   2. In Step 1, enter `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly` → **Authorize APIs**.
   3. Sign in and **pick the Brand Account channel** if Google asks. Then **Advanced** → **Go to … (unsafe)** → **Allow**.
   4. In Step 2, click **Exchange authorization code for tokens** → copy the refresh token to `YOUTUBE_REFRESH_TOKEN`.
7. **Test upload:** set `YOUTUBE_PRIVACY=private` and `ENABLE_AUTO_UPLOAD=true` for one run. In Studio → **Content**, check that the video is on the right channel and not marked "Locked". Then set `public`.

> **Google/YouTube API gotchas**
> - **Private-lock audit: the current docs say it no longer applies.** Since July 2020, videos from unverified projects were forced to private until the project passed an audit ([revision history](https://developers.google.com/youtube/v3/revision_history)). The `videos.insert` reference now says: *"Videos uploaded from unverified API projects are not restricted to private viewing mode"* ([videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), updated 2026-10-15). No changelog entry announces this, so still do step 7.
>   - If a video does show "Locked", request an audit through the [audit and quota form](https://support.google.com/youtube/contact/yt_api_form) ([audit guide](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)).
>   - Until the audit passes, upload as private and publish by hand.
> - **New quota model (since 1 Jun 2026):** `videos.insert` has **its own bucket of 100 calls/day at 1 unit each**. Other methods share 10,000 units/day ([Getting started](https://developers.google.com/youtube/v3/getting-started)). Older guides quoting "1,600 units per upload" are out of date.
> - **Refresh tokens can still die.** Causes: you revoke access, the token goes unused for 6 months, or you exceed 100 live tokens per account per client. In that last case the oldest token is invalidated without warning ([source](https://developers.google.com/identity/protocols/oauth2#expiration)). So don't regenerate tokens repeatedly.
> - **Developer policies:** automated uploads need your prior consent, and you must keep control over privacy status ([Developer Policies](https://developers.google.com/youtube/terms/developer-policies), updated 2026-10-15). A pipeline that only you use meets both. Service accounts can't upload to normal channels.

---

## Part C: Facebook Page and Instagram professional account

1. **Create the Page:** Facebook → menu → **Pages** → **Create new Page** → name, category ("Digital creator"), bio → **Create Page** **[UNVERIFIED path: [help page](https://www.facebook.com/help/104002523024878) didn't render]**.
2. **Switch Instagram to Professional:** Profile → menu → **Settings and activity** → **Account type and tools** → **Switch to professional account** → category → **Creator** or **Business** ([help](https://www.facebook.com/help/instagram/502981923235522)).
   - Both types get insights and work with the API. **Creator** fits a story channel.
   - Switching makes a private account public.
3. **Link Instagram to the Page.** The Facebook Login API needs the Instagram account connected to a Page you manage ([overview](https://developers.facebook.com/docs/instagram-platform/overview)).
   - Instagram → **Edit profile** → **Page** → **Connect**, or
   - Page or Meta Business Suite settings → **Linked accounts → Instagram** **[UNVERIFIED paths: [help page](https://www.facebook.com/help/instagram/570895513091465) didn't render]**.
4. **Optional:** create a Business portfolio (business.facebook.com) that owns both accounts. You only need it for the System User token (D5, option B).

---

## Part D: Meta developer app and token

1. **Create the app:** register at developers.facebook.com → **My Apps → Create app** → name and email ([Create an app](https://developers.facebook.com/docs/development/create-an-app/)).
   - Use case: **Other** → app type **Business** **[UNVERIFIED: the docs confirm "Other" but don't describe the Business type]**.
   - Then add **Facebook Login for Business** and **Instagram** in the dashboard.
2. **API variant: Instagram API with Facebook Login.** The pipeline calls `graph.facebook.com` with an Instagram ID found through a Page, which is this variant ([overview](https://developers.facebook.com/docs/instagram-platform/overview)). The Instagram-Login variant uses `graph.instagram.com` and `instagram_business_*` scopes, so it would need code changes.
3. **Permissions** ([reference](https://developers.facebook.com/docs/permissions)):
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`
   - `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`
   - **`instagram_manage_comments`**, needed for the first comment the pipeline posts (listed in `.env.example`).
   - `business_management`, if a business portfolio owns the Page.
4. **No App Review for your own accounts.** Business apps get **Standard Access** automatically, which covers people with a role on the app. App Review and Business Verification are only for **Advanced Access**, meaning other people's accounts ([access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)).
   - **Dev vs Live mode:** Meta requires Live mode for production ([Meta, 2019](https://developers.facebook.com/blog/post/2019/09/23/live-mode-for-production-use/)).
   - Third-party docs report that Page posts from Development-mode apps are visible only to app roles ([Postiz](https://docs.postiz.com/providers/facebook.md)) **[UNVERIFIED by Meta docs]**.
   - Open your first post while logged out. If it's hidden, fill in **App settings → Basic** (privacy policy URL, icon) and switch the app to **Live**.
5. **Create the token for `META_ACCESS_TOKEN`.**
   **Option A: Page token with no expiry date (simplest).**
   1. [Graph API Explorer](https://developers.facebook.com/tools/explorer) → your app → **Get User Access Token** → tick the step 3 permissions → **Generate**.
   2. Exchange it for a ~60-day user token, from a terminal and never in a browser: `GET https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN` ([long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived)).
   3. `GET /me/accounts?fields=id,name,access_token`. The Page's `access_token` has "no expiration date" but can still be invalidated (same source).
      - Put that `access_token` in `META_ACCESS_TOKEN`.
      - Put the Page `id` in `FACEBOOK_PAGE_ID`.
   4. `GET /{page-id}?fields=instagram_business_account` → put the returned `id` in `INSTAGRAM_BUSINESS_ACCOUNT_ID` ([setup](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started)).
   5. Check the token in the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken).
   - Instagram publishing with Facebook Login uses a Page token ([content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)), and Facebook Reels need one too, so one token covers both.

   **Option B: System User token** (sturdier; needs a Business portfolio):
   - Business Settings → **Users → System users** → **Add** (Admin) → assign the Page, Instagram account and app → **Generate token** with expiry "never" ([Meta Business Help](https://www.facebook.com/business/help/503306463479099), [docs](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/)).
   - You can copy the token only once.
6. **No public video URL or bucket needed.** The pipeline uses Instagram's resumable upload: it creates the container with `upload_type=resumable`, posts the local MP4 to `rupload.facebook.com`, waits for `status_code` `FINISHED` (checking about once a minute, up to 5 minutes), then publishes ([content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)). This only works with Facebook Login for Business, which is the setup in this guide.
7. **Reels specs:** MP4 or MOV, H.264 or HEVC, AAC up to 48 kHz, 23–60 fps, max width 1920, 9:16, up to 25 Mbps, 3 s–15 min, 300 MB or less ([IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)). The pipeline's 1080×1920 videos of 30–50 s fit.

> **Instagram gotchas**
> - **Limits:** 100 API posts per 24 h. The same page also says 50, so treat 50 as the ceiling. Check usage with `GET /{ig-id}/content_publishing_limit`. You can make at most 400 containers per 24 h, and they expire after 24 h ([content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)).
> - **Polling:** Meta suggests polling `status_code` about once a minute, for up to 5 minutes.
> - **Page Publishing Authorization:** if the linked Page requires it, publishing fails until you complete it.
> - **Resumable upload needs Facebook Login for Business** ("only for apps that have implemented Facebook Login for Business"). With the Instagram-Login variant the upload step would have to change.
> - Filters and shopping tags aren't supported over the API.

---

## Part E: Facebook Page Reels

Source for this part: [Reels Publishing API](https://developers.facebook.com/docs/video-api/guides/reels-publishing).

1. **Token:** a Page token from a user with `CREATE_CONTENT` on the Page, plus `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`. The Option A token qualifies.
2. **Where it works:** Pages only, not profiles. Visibility is always public.
3. **Specs:** MP4, 9:16, 1080×1920 recommended (540×960 minimum), 24–60 fps, **3–90 s**, H.264 or H.265, AAC 48 kHz stereo at 128 kbps or more.
4. **Flow:** `upload_phase=start` → upload the binary to `rupload.facebook.com` → `finish` with `video_state=PUBLISHED`. That's what the code does. `SCHEDULED` is also allowed, from 10 minutes to 29 days ahead.

> **Facebook gotchas**
> - **30 API-published Reels per rolling 24 h per Page.**
> - **AI disclosure:** `is_ai_generated: true` on the finish call (default `false`). The pipeline sends it.
> - **Insights:** Reels use `blue_reels_play_count` / `fb_reels_total_plays` and `post_video_avg_time_watched`, not `total_video_views` ([video insights](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/)). That page also lists `pages_manage_engagement` as a requirement **[UNVERIFIED in practice]**.
> - A copyright check runs on every upload.

---

## Part F: Meta AI labels and monetization in India

- **"AI info" label.** Meta says "We'll require people to use this disclosure and label tool" for photorealistic video or realistic-sounding audio, and "may apply penalties" if you don't ([Meta, 6 Feb 2024](https://about.fb.com/news/2024/02/labeling-ai-generated-images-on-facebook-instagram-and-threads/)). The label was renamed from "Made with AI" to "AI info" on 1 Jul 2024 ([Meta](https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/)).
  - **API:** Instagram containers take `is_ai_generated` ([IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)), and so do Facebook Reels.
  - **In the app** (phone only): the "Label as made with AI" toggle on the share screen ([help](https://help.instagram.com/761121959519495)) **[UNVERIFIED exact label]**.
- **"AI-generated profile" label (31 Aug 2026)** is for profiles that feature an *AI-generated person*. If such a profile is unlabeled, it can lose recommendations ([Instagram Creators](https://creators.instagram.com/blog/ai-generated-profile-label)). A story channel without an AI presenter doesn't need it. To turn it on: **Edit profile → AI-generated profile**.
- **Instagram earnings in India:**
  - **Gifts:** 18+, 500+ followers, payout account. India is on the list, but the page is old ([Gifts](https://help.instagram.com/738469380549477)).
  - **Subscriptions:** reportedly 10k followers **[UNVERIFIED, third-party]**.
  - There's no general Reels ad revenue share.
- **Facebook Content Monetization** is **invite-only**, with no published country list. Register interest under Professional dashboard → **Monetization** ([Meta](https://creators.facebook.com/tools/facebook-content-monetization)).
- Meta's July 2025 crackdown cuts reach and monetization for repeat reposters of unoriginal content ([TubeFilter](https://www.tubefilter.com/2025/07/15/ai-slop-unoriginal-repetitive-content-monetization-facebook-meta/)) **[secondary source]**.

---

## Part G: First-week checklist

YouTube's official advice: start with a test upload, then keep "a posting schedule you can maintain", because "consistency is key" ([Shorts tips](https://support.google.com/youtube/answer/12921536)). YouTube recommends no specific number per day.

1. Days 1–2: finish Parts A–E. Post one video by hand per platform and confirm it's public when viewed logged out.
2. Day 2: run the pipeline once with `YOUTUBE_PRIVACY=private` and check all three platforms.
3. Days 3–7: post 1 video a day at a fixed time (the default `CRON_GENERATE_SCHEDULE=0 18 * * *`). Move to 2 a day once quality holds. Both are far below every API limit.
4. Watch retention daily (Studio → Analytics, Instagram insights). The weekly `evolve` job waits for 4 or more scored videos.
5. Review every story yourself (hook, title, source credit). That review is your protection against the inauthentic and unoriginal content rules.

---

## Pipeline changes made after this research

1. **Graph API version:** all Instagram and Facebook calls use `META_GRAPH_VERSION` (default `v26.0`); v21.0 expires 21 Jan 2027 ([versions](https://developers.facebook.com/docs/graph-api/changelog/versions)).
2. **Insights:** Instagram reads `views` instead of the retired `plays`; Facebook Reels read `blue_reels_play_count` and `post_video_avg_time_watched`.
3. **AI disclosure:** `is_ai_generated: true` is sent on the Instagram container and the Facebook Reels finish call.
4. **Instagram upload:** resumable local upload; `PUBLIC_VIDEO_BASE_URL` was removed.
5. **Instagram polling:** checks for up to 5 minutes and fails cleanly instead of publishing an unfinished container.
6. **Still on you — YouTube:** per current docs there's no private lock and the limit is 100 uploads a day. Keep `YOUTUBE_PRIVACY=private` only until the B7 test upload shows as not "Locked".
