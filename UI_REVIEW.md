# 讯枝 UI/UX review

2026-10-20. This review covers the build on the Mate 60 Pro (screens captured 00:46–00:50) and `Index.ets` as of 01:14. It comes from screenshots and code only; I didn't touch the phone while Codex was driving it. Findings marked *(code)* come from reading the source and haven't been reproduced on the device.

The red numbers on the annotated screens match the numbers below: [build/ui-review/xunzhi-ui-review-annotated.jpg](build/ui-review/xunzhi-ui-review-annotated.jpg). `build/` is gitignored, so the image stays out of commits.

## Verdict

The components are the right ones: Navigation/NavDestination, CARD lists, SegmentButton, bindSheet, SymbolGlyph, a single brand green, and a reader locked down by CSP. What's missing is editing of how they're put together. Every state gets a visible label, every row gets a button, and every control keeps its default colour. As a result, the loudest thing on every screen is chrome:
- in the list, the green filter pill;
- in Settings, the blue buttons;
- on Home, three floating circles;
- on every page, a status line about something else.

NetNewsWire's taste is mostly subtraction. Three rules cover most of what follows:

1. **Content is the loudest thing on the screen.** Headlines and body text come first; controls stay quiet until you reach for them.
2. **One accent, one meaning.** Green means unread, selected, or primary action, and system blue never appears. Yellow (star) and red (error) mark state only.
3. **Say it once, in the right place.** The feed name belongs in the title, not in every row. 未读 belongs in one control, not a label plus a control. Refresh status belongs on Home, not on every page.

## Do these ten first

| # | Change | Why first |
|---|---|---|
| 1 | Add 下一篇未读 in the reader and 全部标为已读 in lists | The core loop of an RSS reader is missing |
| 2 | Make links in articles open | Every link looks like a link and does nothing |
| 3 | Fix smart collections: titles, counts, sticky filter | The first tap in the app lands on a mislabelled page |
| 4 | Replace the three circles with one native toolbar | One change fixes the overlap, hierarchy, dark-mode shadows, and status |
| 22 | Set the brand colour once with `ThemeControl` | Every stray system-blue control disappears at once |
| 9 | Move the list header into the title bar | About 110vp goes back to headlines |
| 5 | Remove the global status line | It leaks onto unrelated pages and shifts the layout |
| 10 | Use local dates and drop the repeated source name | The list is the screen you look at most |
| 12 | Put source and date above the article title | Readers need to know where and when |
| 16, 17 | Make the add sheet fit its content; write errors in plain language | These are the first-run and failure experiences |

---

## A. The reading loop

### 1 · The reader is a dead end
An RSS reader is a loop: read → next unread → read. Here every article ends with: go back, scan the list, tap. NetNewsWire's most-used control is "next unread". There is also no way to mark a list read, so getting through 428 unread articles takes one tap per article.
- **Reader top bar:** add `⌄ 下一篇未读` (`sys.symbol.chevron_down`). It hides on scroll with the rest of the bar, so R6 still holds.
- **End of article:** add a quiet footer, `下一篇：<title>`. Make it a link to `xunzhi://next` and catch it in `onOverrideUrlLoading` (see 2). JavaScript stays off.
- **List ⋯ menu:** add `全部标为已读`. The confirmation names the scope and count (the copy is already in UI_DESIGN §6), and an undo toast follows. The ordered list that "next" needs is just `visible()` at the moment the article was opened.

### 2 · Links inside articles do nothing *(code)*
- **What's wrong:** `Web.onOverrideUrlLoading(() => true)` (Index.ets:722) blocks every navigation and hands nothing on. "where he wrote" in screen C is green, underlined, and dead. This has been the case since the committed P2 version.
- **Why it matters:** UI_DESIGN §5.4 says links open through the system.
```ts
.onOverrideUrlLoading((request: WebResourceRequest) => {
  const url = request.getRequestUrl();
  if (url === 'xunzhi://next') { this.openNextUnread(); return true; }
  if (/^https?:\/\//i.test(url)) this.context().openLink(url).catch(() => {});
  return true;
})
```
- **Footnotes:** same-page `#footnote` links resolve against `<base>`. If a URL differs from the article link only in its fragment, jump within the page; don't open the browser.

### 3 · Smart collections don't mean what they say
- **Wrong title.** Tapping 今天, 未读 or 全部 opens a page titled **所有订阅**. `chooseScope('', '', filter)` leaves no feed selected, so `scopeTitle()` falls back.
- **Mixed counts.** One right-aligned column holds three kinds of number: 今天 29 counts all of today's articles, 未读 428 counts unread, and 全部 435 counts everything. Readers assume a column holds one kind of number.
- **全部 isn't a collection.** It is the "show read articles" state of any list.
- **The filter is global and sticky** *(code)*. Open 星标, go back, then tap Daring Fireball. `chooseScope(feed.id)` inherits `this.filter`, so the "Daring Fireball" list shows only starred articles. The 未读/全部 control is hidden and a 查看未读 button replaces it.
- **Fix:**
  - Use three collections, 今天, 未读 and 星标 (NetNewsWire's own set).
  - Title each page with the name of the row you tapped.
  - Make every count in the library an unread count.
  - Make "show read articles" a per-list toggle (see 9) that never lives in the scope.
  - Delete 查看未读.

## B. Home

### 4 · Three floating circles → one toolbar
- **What's wrong:**
  - Three sizes (56/48/56vp) with no shared material.
  - They sit on top of the last row ("Ma⚙n Reece" in screen A).
  - The `#18000000` shadow is invisible in dark mode.
  - The middle circle shows a refresh arrow but opens a sheet; the real refresh button is inside that sheet.
  - ＋ goes grey during refresh.
- **Fix:** R5 puts settings and activity at bottom-left and add at bottom-right. That is exactly NetNewsWire's bottom toolbar: ⚙ · status text · ＋. Build it natively:
```ts
Navigation(this.paths) { … }
  .toolbarConfiguration(this.homeToolbar, {
    barStyle: BarStyle.STACK,                    // the full-height list scrolls under the bar
    backgroundBlurStyle: BlurStyle.COMPONENT_THICK,
  })
```
- **Contents:** `homeToolbar` holds ⚙ (48vp), the status text centred, and ＋ (48vp, with the existing menu).
- **Why STACK:** with blur, it keeps the full-height list from the "truly floating" iteration, with one material instead of three.
- **Status text:** it replaces the activity circle and opens 当前活动 when tapped. It reads 刚刚更新 / 12 分钟前更新 / 正在更新 5/12 / ⚠ 2 个订阅未能更新.
- **＋** stays enabled during refresh.

### 5 · The status line follows you everywhere
- **What's wrong:** `status()` prints the global `message` at the top of Home, every list, Settings, and the reader (Index.ets:700/707/715/746). In screen B, Daring Fireball's list opens with "2 个订阅未能更新", which is about other feeds. The line appears and disappears, pushing content down each time.
- **Fix:**
  - **Persistent state:** the Home toolbar text only (see 4).
  - **One-off results:** a toast, `this.getUIContext().getPromptAction().showToast({ message: '已添加 少数派' })`.
  - **Per-feed errors:** on the feed's own row, where the ⚠ glyph already is.

### 6 · A ⋯ button on every row
- **What's wrong:**
  - The 2×2 dots are the correct HarmonyOS "more" glyph, but twelve of them in a column become texture, crowded in with the counts and ⚠ glyphs.
  - The buttons are 40×44vp; UI_DESIGN's minimum is 48.
  - They draw the legacy `sys.media.ohos_ic_public_more` bitmap, not the symbol.
  - Long-press already opens the same menu.
- **Fix:**
  - Delete them; keep long-press.
  - Add `ListItem.swipeAction` with 移动 / 取消订阅.
  - Make the ⚠ glyph tappable so it explains the error.
  - If you want a visible affordance, use one ⋯ in the title bar that opens an edit mode.

### 7 · The icons mix styles
- **未读 icon:** it's an outline `circle`, which looks like an unselected radio button and doesn't match the filled unread dot in lists. Use `circle_fill` (or `smallcircle_filled_circle`).
- **Fill style:** sun and book are outlines and the star is filled. Pick one fill style. Yellow is fine for the star, since that's its state colour.
- **Monogram fallback:** a thin accent-coloured letter on a near-invisible tile; "I" for inessential is a single hairline. Use a filled neutral tile with a medium-weight letter.
- **Favicons:** cached at 64px but drawn at 28vp (≈91px), so they're upscaled. Cache at ≥96px. The fresh Daring Fireball 64/314px icon files in `/tmp` suggest this is already in progress.
- **Headers:** 订阅 → 文章 → 我的订阅. "文章" over the smart group labels nothing; drop it.

### 8 · First run is an afterthought *(code)*
- **What's wrong:** with no subscriptions, Home shows four smart rows without counts and a card saying 还没有订阅. The designed empty state (从一个喜欢的网站开始 + 添加订阅 + 导入订阅) lives on the article-list page. Nobody with zero feeds will ever get there.
- **Fix:** move it to Home, with one brand-filled 添加订阅 button and one text button, 导入 OPML 文件. Hide the smart rows until they have something in them.

## C. Article list

### 9 · Three rows of chrome before the first headline
- **What's wrong:** between the title bar and the first article sit the status line, `未读 · 47 篇`, and a full-width solid-green segment. The first headline starts 24% of the way down the screen (y 663 of 2720), and the brightest object on the page is a filter pill, not an article.
- **Fix:**
  - **Title bar:** `NavDestination().title({ main: 'Daring Fireball', sub: '47 篇未读' })` moves the count into the native subtitle.
  - **Filter:** replace the segment with a title-bar toggle, a filter glyph that is filled while read articles are hidden. The subtitle then switches to 共 435 篇.
  - **Title-bar items:** 🔍, the filter toggle, and ⋯ (刷新, 全部标为已读). Today the list's refresh button refreshes all 12 feeds, so it doesn't belong on one feed's page anyway.
  - **If you keep the SegmentButton:** keep it neutral. Use a surface-coloured selected pill with primary text, set as a pair so the dark-mode contrast fix still holds. Avoid the solid accent fill.
- **Result:** about 110vp of extra content, most of another article.

### 10 · Rows: dates and repetition
- **US dates:** every row in screen B ends "10/20/2026", because `toLocaleDateString()` gives US format and no time. Use UI_DESIGN's own spec: 15:42 today, then 昨天, 10月18日, 2025年10月18日.
- **Repeated source:** "Daring Fireball" appears on every row of the Daring Fireball list.
  - In single-feed lists, hide the source.
  - In 今天/未读/星标 and folder lists, show a 16vp favicon plus the source. That's where it carries information.
- **Spacing:** the excerpt and meta row run together (6vp apart, both secondary grey). Give the meta row a little air.

### 11 · Search
- **What's wrong:** the helper line 搜索标题和已下载的正文 is a separate row that pushes the list down.
- **Fix:** put the scope in the placeholder, `在 Daring Fireball 中搜索`, and drop the helper line.

## D. Reader

### 12 · The article doesn't say where or when
- **What's wrong:** the body starts with the title, then "John Gruber" as an ordinary paragraph, which reads as the article's first line. There is no feed name and no date, and the title isn't a link to the original.
- **Fix:** in `readerHtml()`:
```html
<header>
  <p class="source">Daring Fireball · 10月20日 15:42</p>
  <h1><a href="…original…">From the DF Archive: …</a></h1>
  <p class="byline">John Gruber</p>
</header>
```
- **Styling:**
  - `.source` and `.byline` take 0.8em in the secondary colour.
  - The title link inherits the text colour, with no underline.
  - Add `h1{text-wrap:balance}`.
- **Line height:** 1.8 suits CJK but is loose for Latin text; about 1.6 is better when the feed declares an English `lang`.

### 13 · Top bar: hand-built buttons, wrong priorities
- **What's wrong:**
  - Aa and ⋯ are custom circles, passed to `menus()` as a builder. The ⋯ uses the legacy bitmap.
  - Aa is a set-once preference, yet it holds a permanent slot.
  - Star (used per article) and next (used constantly) have no slot.
- **Fix:**
  - Use the native `menus([...])` array with `symbolIcon`, so size, press state, and alignment come from the system.
  - Slots: ☆/★, ⌄ 下一篇未读, ⋯. Move 阅读设置 into ⋯.
  - Give every menu entry a `symbolIcon`.
  - Rename 原文 → 在浏览器中打开.

### 14 · 阅读设置 hides the text it changes
- **What's wrong:** a LARGE sheet covers the whole article. You adjust font size against a stand-in sentence (这是正文的显示大小。) instead of what you're reading. The Radio and Slider are system blue (see 22).
- **Fix:**
  - Use `height: SheetSize.FIT_CONTENT` with a light `maskColor`, so the article stays visible and updates live above the sheet.
  - Show theme as three swatches (系统/浅/深) and size as a stepper (A− 18 A+).
  - Drop the preview box.

### 15 · Pure black with near-white text
- **What's wrong:** dark reading is #000000 with #F2F3EF text. On OLED, that maximises halation in long reads and smear when scrolling.
- **Fix:** keep R7's single colour from bar to body, but make it a softer one, e.g. #121212 everywhere with #E6E6E1 text. Low priority; a matter of taste.

## E. Sheets

### 16 · Add subscription
- **What's wrong:**
  - One text field in a sheet that covers the whole screen.
  - The field isn't focused when the sheet opens.
  - The helper text wraps, leaving 地址。 alone on a line.
  - 查找订阅 is a small system-blue button aligned left, and it's disabled during refresh.
  - Candidates appear as blue buttons labelled with raw URLs.
  - Errors appear under the button, not under the field.
- **Fix:**
  - **Sheet:** use `SheetSize.FIT_CONTENT`.
  - **Field:** add `defaultFocus(true)`, keep `InputType.URL`, and add `enterKeyType(EnterKeyType.Go)` with `onSubmit` to start the search.
  - **Button and helper:** a full-width brand button, with helper text short enough not to wrap.
  - **Clipboard:** if it holds a URL, offer it with the system `PasteButton`.
  - **Candidates:** show them as rows, title first and the URL in secondary text.
  - **Errors:** show them under the field in `reader_error`.
  - **Success:** close the sheet, show a toast, and reveal the new feed.

### 17 · 当前活动
- **What's wrong:**
  - The sheet opens with 暂无活动 ("no activity") and then lists two failures, because `message` is empty while `feed.error` isn't.
  - The failures are raw transport strings.
  - The only action is a system-blue 刷新订阅.
- **Header line:** `12 个订阅 · 01:12 更新 · 2 个未能更新`, or `正在更新 5/12` while a refresh runs.
- **One row per failing feed:** favicon, a plain-language reason, last successful update, and 重试 / 打开网站.

| Raw | Say |
|---|---|
| Internal error, connection failures | 无法连接到网站 |
| Transferred a partial file | 下载中断，稍后会重试 |
| HTTP 404 / 410 | 订阅地址已失效 |
| Parse errors | 内容格式无法识别 |
| Timeouts | 网站响应超时 |

- **Raw string:** keep it, behind a long-press 复制错误详情.

### 18 · New folder
- **What's wrong:** a full-height sheet for one field, with a small blue 新建 button.
- **Fix:** use a FIT_CONTENT sheet or a small dialog with the field focused, and let Enter create the folder.

## F. Settings

### 19 · Two headers, misaligned, ungrouped
- **Double header:** 阅读 sits further in than its own content (a 16vp `sectionTitle` inside a 20vp-padded list). 外观 follows immediately as a second header, so there are two levels of label before the first option.
- **No grouping:** Home uses CARD groups but Settings is a flat list, so the two screens look like different apps.
- **Fix:** one `ListItemGroup({ style: ListItemGroupStyle.CARD, header, footer })` per group, each with one header:
  - 阅读: 主题 and 正文字号.
  - 订阅: 导入 and 导出, with a footer.
  - 关于.

### 20 · Buttons that should be rows
- **What's wrong:**
  - 导入订阅 / 导出订阅 are system-blue capsules: the most saturated thing in the app, for a once-a-year action.
  - 暂不支持多设备同步 is set larger and bolder than the explanation above it, so the screen's headline is a missing feature.
- **Fix:**
  - Two rows with chevrons: 导入 OPML 文件 › and 导出 OPML 文件 ›.
  - Put the OPML scope in the group footer.
  - Make the sync note a secondary footer line.

### 21 · Preview and About
- **Font size:** a raw number, a slider, and a box that describes itself. Show, don't describe: render a real title and two lines at the chosen size, or reuse the reader's sheet (see 14).
- **About:** 关于 shows only 讯枝. Add the version and build number, and open-source licences. The long-press developer menu can stay hidden.

## G. Across the app

### 22 · Two accent colours
- **What's wrong:** green covers unread dots, links, smart-row icons, and the segment. Everything ArkUI draws by default is system blue:
  - Radio (screens D, E);
  - Slider (screen E);
  - every Button: 查找订阅, 新建, 刷新订阅, 导入/导出, and the empty-state buttons.

  In effect the app has two brand colours.
- **Fix:** set the theme once, before `loadContent`:
```ts
import { CustomColors, CustomTheme, ThemeControl } from '@kit.ArkUI';

class XunzhiColors implements CustomColors {
  brand: ResourceColor = $r('app.color.reader_accent');
  fontEmphasize: ResourceColor = $r('app.color.reader_accent');
  iconEmphasize: ResourceColor = $r('app.color.reader_accent');
  compBackgroundEmphasize: ResourceColor = $r('app.color.reader_accent');
  fontOnPrimary: ResourceColor = $r('app.color.reader_on_accent');
}
class XunzhiTheme implements CustomTheme { colors: CustomColors = new XunzhiColors(); }
ThemeControl.setDefaultTheme(new XunzhiTheme());
```
- **Verify on the device:** the d.ts doesn't document which token each component reads, so check Radio, Slider, Toggle, and filled Button in both modes.
- **Dark-mode contrast:** the dark accent is #8BC5A6, so text on filled buttons must use `reader_on_accent` (#10291F), never white.

### 23 · Surfaces
- **Light mode:** three whites on adjacent screens. Home canvas is #F4F5F3 with white cards, the list is system white, and the reader is #FCFCFB.
- **Dark mode:** #000 everywhere except the #151515 circles.
- **Fix:** use two roles.
  - **Grouped screens** (Home, Settings) share one background.
  - **Reading screens** (list, reader) share one paper colour, so going from list to article doesn't flash a different white.

### 24 · Touch targets
- **What's wrong:** the row ⋯ and the folder chevron are 40×44vp, and the activity circle is 48. UI_DESIGN's minimum is 48×48.
- **Fix:** keep the 20–24vp glyphs and enlarge the button frame or `responseRegion`.

### 25 · Feedback and copy
- **Toasts for results:** 已添加 少数派 · 20 篇, 订阅已导入, 已更新.
- **Busy lock:** don't disable ＋ or 查找订阅 during refresh. The `busy` lock is an implementation constraint leaking into the UI; UI_DESIGN §5.1 already says so.
- **Copy fixes:**
  - 原文 → 在浏览器中打开.
  - 暂无活动 only when nothing is wrong.
  - Remove the 这是正文的显示大小。 box (see 14, 21).
  - Translate the English transport errors (see 17).

### 26 · Engineering you'll feel
- **What's wrong:**
  - Lists use `ForEach` over every article, 435 now and thousands later, so every state change rebuilds every row.
  - `visible()` runs several times per render, and on each search keystroke it strips HTML from every article.
  - `unread()` scans all articles once per feed row.
- **Fix:** use `LazyForEach` with memoised counts and search text. Scrolling and refresh will stutter long before anything looks wrong.

## Already good — keep it

- **Navigation:** native everywhere, with system back and no fake iOS chrome.
- **Library:** CARD groups, right-aligned counts, and real favicons, the bones of NetNewsWire's sidebar.
- **Reader typography:** a 680px measure, 1.8 line height for CJK, and quiet blockquotes, with JavaScript off and a strict CSP.
- **Reading chrome:** hiding the reader bar while you read (R6) is exactly right.
- **Copy:** mostly disciplined. 订阅已导入, 已经读完了, and 暂不支持多设备同步 stand in for a dead toggle.

## Suggested batches

1. **Quick, mostly mechanical:** 2 (links), 22 (theme), 5 (status → toast), 10 (dates, source), 19–21 (settings rows), and 25 (copy).
2. **Structure:** 3 (collections and filter), 4 (home toolbar), 6 (swipe instead of ⋯), 9 (list header), and 8 (first run).
3. **Reading:** 1 (next unread, mark all read), 12–14 (header, top bar, settings sheet), and 16–18 (sheets).
