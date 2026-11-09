/* Documentation site runtime: path routing with hash fallback, the collapsible
   navigation tree, search, reading progress, table of contents, code copy, and
   the narrow-screen drawer. */
/* eslint-disable max-lines -- the dependency-free runtime keeps every shell feature in one script. */
(() => {
  "use strict";

  const NAV_STORAGE_KEY = "rpe-docs-nav-expanded";
  const LOCALE_STORAGE_KEY = "rpe-docs-locale";

  const state = {
    content: null,
    catalog: null,
    locale: "zh",
    pages: [],
    byRoute: new Map(),
    activeRoute: "",
    results: [],
    selected: 0,
    searchTimer: 0,
    searchActive: false,
    searchRoutes: new Set(),
    searchExpandedIds: new Set(),
    navById: new Map(),
    navAncestors: new Map(),
    navExpanded: new Map(),
    navChildrenSeq: 0,
  };

  const elements = {};

  /** Read one translated shell string with a safe fallback for older builds. */
  function copy(key, fallback = "") {
    return state.content?.shell?.[key] ?? fallback;
  }

  /** Apply translated labels to the static documentation shell. */
  function applyShellCopy() {
    document.documentElement.lang = state.content?.htmlLang ?? "zh-CN";
    document.title = state.content?.title ?? "RPE Redux Extension SDK";
    const setText = (selector, key) => {
      const node = document.querySelector(selector);
      if (node) {
        node.textContent = copy(key);
      }
    };
    setText(".docs-skip", "skip");
    setText(".docs-brand-copy small", "brand");
    setText(".docs-toc-title", "toc");
    elements.menuToggle?.setAttribute("aria-label", copy("openMenu"));
    elements.searchInput?.setAttribute("placeholder", copy("searchPlaceholder"));
    document
      .querySelector(".docs-visually-hidden")
      ?.replaceChildren(document.createTextNode(copy("searchLabel")));
    elements.searchResults?.setAttribute("aria-label", copy("searchResults"));
    elements.sidebar?.setAttribute("aria-label", copy("sidebar"));
    elements.backdrop?.setAttribute("aria-label", copy("closeMenu"));
    elements.toc?.setAttribute("aria-label", copy("toc"));
    elements.pager?.setAttribute("aria-label", copy("pager"));
    if (elements.localeToggle) {
      const currentCode = state.locale.split("-")[0] || state.locale;
      elements.localeCurrent.textContent = currentCode;
      elements.localeToggle.setAttribute(
        "aria-label",
        `${copy("languageMenu", copy("language", "Language"))}: ${currentCode}`,
      );
      renderLocaleMenu();
    }
  }

  /** Open or close the language menu and keep its button state accessible. */
  function setLocaleMenuOpen(open) {
    if (!elements.localeMenu || !elements.localeToggle) {
      return;
    }
    elements.localeMenu.hidden = !open;
    elements.localeToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /** Render every locale as an explicit choice instead of cycling implicitly. */
  function renderLocaleMenu() {
    if (!elements.localeMenu) {
      return;
    }
    elements.localeMenu.replaceChildren();
    for (const locale of Object.keys(state.catalog ?? {})) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "docs-locale-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", locale === state.locale ? "true" : "false");
      option.dataset.locale = locale;
      const label = document.createElement("span");
      label.textContent = state.catalog?.[locale]?.label ?? locale;
      const code = document.createElement("span");
      code.className = "docs-locale-option-code";
      code.textContent = locale.split("-")[0] || locale;
      option.append(label, code);
      elements.localeMenu.append(option);
    }
  }

  /** Close the data-structure inspector dialog. */
  function closeTypeInspector() {
    elements.typeModal?.remove();
    elements.typeModal = null;
  }

  /** Open one data structure in a small VS Code-style reference dialog. */
  function openTypeInspector(typeId) {
    const type = (state.content?.types ?? []).find((candidate) => candidate.id === typeId);
    if (!type) {
      return;
    }
    closeTypeInspector();
    const backdrop = document.createElement("div");
    backdrop.className = "docs-type-modal-backdrop";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeTypeInspector();
      }
    });
    const dialog = document.createElement("section");
    dialog.className = "docs-type-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "docs-type-modal-title");
    const header = document.createElement("header");
    header.className = "docs-type-modal-header";
    const title = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "docs-type-modal-eyebrow";
    eyebrow.textContent = copy("typeEyebrow", "Data structure");
    const heading = document.createElement("h2");
    heading.id = "docs-type-modal-title";
    heading.textContent = type.name;
    title.append(eyebrow, heading);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "docs-type-modal-close";
    close.setAttribute("aria-label", copy("closeType", "Close data structure reference"));
    close.textContent = "×";
    close.addEventListener("click", closeTypeInspector);
    header.append(title, close);
    const body = document.createElement("div");
    body.className = "docs-type-modal-body";
    const summary = document.createElement("p");
    summary.className = "docs-type-modal-summary";
    summary.textContent = type.summary;
    const source = document.createElement("p");
    source.className = "docs-type-modal-source";
    source.textContent = `${copy("typeSource", "Defined in: ")}${type.source}`;
    const code = document.createElement("pre");
    const codeNode = document.createElement("code");
    codeNode.textContent = type.definition;
    code.append(codeNode);
    const references = document.createElement("div");
    references.className = "docs-type-modal-references";
    const referencesTitle = document.createElement("h3");
    referencesTitle.textContent = copy("typeReferences", "Used by");
    references.append(referencesTitle);
    if (!type.references?.length) {
      const empty = document.createElement("p");
      empty.textContent = copy(
        "typeNoReferences",
        "No generated API page directly references this type.",
      );
      references.append(empty);
    } else {
      const list = document.createElement("ul");
      for (const reference of type.references) {
        const item = document.createElement("li");
        const link = document.createElement("button");
        link.type = "button";
        link.className = "docs-type-reference";
        link.textContent = reference.title;
        link.addEventListener("click", () => {
          closeTypeInspector();
          navigate(reference.route);
        });
        item.append(link);
        list.append(item);
      }
      references.append(list);
    }
    body.append(summary, source, code, references);
    dialog.append(header, body);
    backdrop.append(dialog);
    document.body.append(backdrop);
    elements.typeModal = backdrop;
    close.focus();
  }

  /** Cache one element by id. */
  function byId(id) {
    return document.getElementById(id);
  }

  /** The deployed documentation root; the host serves every deep link there. */
  function docsBase() {
    const marker = "/docs/";
    const index = location.pathname.indexOf(marker);
    if (index >= 0) {
      return location.pathname.slice(0, index + marker.length);
    }
    if (location.pathname.endsWith("/docs")) {
      return `${location.pathname}/`;
    }
    const apiIndex = location.pathname.indexOf("/api/");
    if (apiIndex >= 0) {
      return location.pathname.slice(0, apiIndex + 1);
    }
    const lastSlash = location.pathname.lastIndexOf("/");
    return location.pathname.slice(0, lastSlash + 1) || "/";
  }

  /** Build a browser path for one page route and optional heading anchor. */
  function hrefFor(route, anchor = "") {
    const base = docsBase();
    return `${base}${route}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
  }

  /** Push or replace one route, then render it. */
  function navigate(route, anchor = "", replace = false) {
    const href = hrefFor(route, anchor);
    if (replace) {
      history.replaceState(null, "", href);
    } else {
      history.pushState(null, "", href);
    }
    handleRoute();
  }

  /** Decode a URL path or hash segment without throwing on malformed input. */
  function decodeSegment(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /** Parse a hash fallback such as `#/page/getting-started`. */
  function parseHashRoute() {
    const raw = location.hash.replace(/^#\/?/u, "");
    if (!raw) {
      return null;
    }
    const [path, anchor = ""] = raw.split("#");
    if (path.startsWith("page/")) {
      return { route: decodeSegment(path.slice("page/".length)), anchor: decodeSegment(anchor) };
    }
    if (path === "api" || path.startsWith("api/")) {
      return { route: path, anchor: decodeSegment(anchor) };
    }
    return null;
  }

  /** Escape a string for use inside a regular expression. */
  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }

  /** Normalize one search token. */
  function tokenize(query) {
    return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  }

  /** Flatten the section tree and index every route. */
  function flattenPages(content) {
    const pages = [];
    for (const section of content.sections ?? []) {
      for (const page of section.pages ?? []) {
        pages.push({ ...page, section: section.title ?? "" });
      }
    }
    state.pages = pages;
    state.byRoute = new Map(pages.map((page) => [page.route, page]));
  }

  /** Create one sidebar link for a navigation node. */
  function navLink(node, label = node.label, className = "") {
    const link = document.createElement("a");
    link.href = hrefFor(node.route);
    link.textContent = label;
    link.dataset.route = node.route;
    link.dataset.slug = node.slug ?? "";
    if (className) {
      link.className = className;
    }
    return link;
  }

  /** Index the navigation tree for route ancestors and toggle lookup. */
  function indexNav(nodes) {
    const visit = (items, ancestors) => {
      for (const node of items ?? []) {
        state.navById.set(node.id, node);
        if (node.route) {
          state.navAncestors.set(node.route, ancestors);
        }
        visit(node.children, [...ancestors, node.id]);
      }
    };
    visit(nodes, []);
  }

  /** Read persisted expansion choices, tolerating blocked or corrupt storage. */
  function readNavExpanded() {
    const expanded = new Map();
    try {
      const raw = window.localStorage.getItem(NAV_STORAGE_KEY);
      if (!raw) {
        return expanded;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return expanded;
      }
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === "boolean") {
          expanded.set(id, value);
        }
      }
    } catch {
      // Private windows and blocked storage simply start with defaults.
    }
    return expanded;
  }

  /** Persist every explicit expansion choice as one JSON object. */
  function writeNavExpanded() {
    try {
      window.localStorage.setItem(
        NAV_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(state.navExpanded)),
      );
    } catch {
      // The tree still works when storage is unavailable.
    }
  }

  /** Whether one node is open, preferring an explicit choice over its default. */
  function nodeExpanded(node) {
    if (state.searchExpandedIds.has(node.id)) {
      return true;
    }
    const stored = state.navExpanded.get(node.id);
    return typeof stored === "boolean" ? stored : node.defaultExpanded === true;
  }

  /** Force every ancestor of the active route open in memory. */
  function expandRouteAncestors(route) {
    for (const id of state.navAncestors.get(route) ?? []) {
      state.navExpanded.set(id, true);
    }
  }

  /** Expand every ancestor of a search hit without touching persisted state. */
  function collectSearchExpanded(routes) {
    const ids = new Set();
    for (const route of routes) {
      for (const id of state.navAncestors.get(route) ?? []) {
        ids.add(id);
      }
    }
    return ids;
  }

  /** Build the shared chevron; CSS rotates it from `aria-expanded`. */
  function navChevron() {
    const marker = document.createElement("span");
    marker.className = "docs-nav-chevron";
    marker.setAttribute("aria-hidden", "true");
    marker.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return marker;
  }

  /** Create the full-row toggle for a group that has no page of its own. */
  function createGroupToggle(node, depth, expanded, childrenId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-nav-group-toggle";
    button.dataset.nodeId = node.id;
    button.dataset.depth = String(depth);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute("aria-controls", childrenId);
    const label = document.createElement("span");
    label.className = "docs-nav-label";
    label.textContent = node.label;
    button.append(label, navChevron());
    if (state.searchExpandedIds.has(node.id)) {
      button.setAttribute("aria-disabled", "true");
      button.title = "搜索期间保持展开";
    }
    return button;
  }

  /** Create the chevron-only toggle that sits beside a navigable group link. */
  function createChevronToggle(node, depth, expanded, childrenId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-nav-toggle";
    button.dataset.nodeId = node.id;
    button.dataset.depth = String(depth);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute("aria-controls", childrenId);
    const label = `${expanded ? (state.locale === "en" ? "Collapse" : "收起") : state.locale === "en" ? "Expand" : "展开"} ${node.label}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(navChevron());
    if (state.searchExpandedIds.has(node.id)) {
      button.setAttribute("aria-disabled", "true");
      button.title = "搜索期间保持展开";
    }
    return button;
  }

  /** Append the rendered children of one navigation group. */
  function appendNavChildren(container, nodes, depth) {
    for (const child of nodes ?? []) {
      container.append(renderNavNode(child, depth));
    }
  }

  /** Render one navigation node and, when open, its child list. */
  function renderNavNode(node, depth) {
    const children = node.children ?? [];
    const expandable = children.length > 0;
    const expanded = expandable && nodeExpanded(node);
    const childrenId = `docs-nav-children-${state.navChildrenSeq}`;
    state.navChildrenSeq += 1;
    const wrapper = document.createElement("div");
    wrapper.className = "docs-nav-node";
    wrapper.dataset.nodeId = node.id;
    wrapper.dataset.depth = String(depth);
    if (node.kind) {
      wrapper.classList.add(`docs-nav-node-kind-${node.kind}`);
    }
    const row = document.createElement("div");
    row.className = "docs-nav-row";
    if (node.route) {
      const link = navLink(node, node.label, "docs-nav-page");
      if (state.searchActive && state.searchRoutes.has(node.route)) {
        link.classList.add("is-search-match");
      }
      row.append(link);
    }
    if (expandable) {
      row.append(
        node.route
          ? createChevronToggle(node, depth, expanded, childrenId)
          : createGroupToggle(node, depth, expanded, childrenId),
      );
    }
    if (row.childElementCount) {
      wrapper.append(row);
    }
    if (expandable) {
      const container = document.createElement("div");
      container.className = "docs-nav-children";
      container.id = childrenId;
      container.hidden = !expanded;
      if (expanded) {
        appendNavChildren(container, children, depth + 1);
      }
      wrapper.append(container);
    }
    return wrapper;
  }

  /** Build the left navigation tree from the generated hierarchy. */
  function renderNav() {
    elements.nav.replaceChildren();
    state.navChildrenSeq = 0;
    if (!state.content) {
      return;
    }
    for (const node of state.content.nav ?? []) {
      const section = document.createElement("section");
      section.className = "docs-nav-section";
      section.append(renderNavNode(node, 0));
      elements.nav.append(section);
    }
    markActiveNav(state.activeRoute);
  }

  /** Mark the current page in the sidebar. */
  function markActiveNav(route) {
    for (const link of elements.nav.querySelectorAll("a[data-route]")) {
      const active = link.dataset.route === route;
      link.classList.toggle("is-active", active);
      link.closest(".docs-nav-row")?.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  /** Toggle one navigation group and remember the explicit choice. */
  function toggleNavNode(button) {
    const node = state.navById.get(button.dataset.nodeId ?? "");
    if (!node || !node.children?.length || state.searchExpandedIds.has(node.id)) {
      return;
    }
    const container = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (!container) {
      return;
    }
    const expanded = button.getAttribute("aria-expanded") !== "true";
    state.navExpanded.set(node.id, expanded);
    writeNavExpanded();
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (button.classList.contains("docs-nav-toggle")) {
      const label = `${expanded ? (state.locale === "en" ? "Collapse" : "收起") : state.locale === "en" ? "Expand" : "展开"} ${node.label}`;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    container.hidden = !expanded;
    container.replaceChildren();
    if (expanded) {
      appendNavChildren(container, node.children, Number(button.dataset.depth ?? "0") + 1);
    }
  }

  /** Parse the browser path into `{ route, anchor }`, with hash fallback. */
  function parseRoute() {
    const base = docsBase();
    let path = location.pathname.startsWith(base)
      ? location.pathname.slice(base.length)
      : location.pathname.replace(/^\/+/u, "");
    path = path.replace(/\/+$/u, "");
    const hashRoute = location.hash.startsWith("#/") ? parseHashRoute() : null;
    if (!path) {
      if (hashRoute) {
        return hashRoute;
      }
      return { route: "", anchor: "" };
    }
    const anchor = location.hash.startsWith("#/")
      ? (hashRoute?.anchor ?? "")
      : decodeSegment(location.hash.replace(/^#/u, ""));
    return { route: path, anchor };
  }

  /** Show the loading state before content arrives. */
  function showLoading() {
    elements.article.innerHTML = `<p class="docs-loading">${copy("loading", "Loading documentation…")}</p>`;
  }

  /** Show a persistent error in the article area. */
  function showError(message) {
    elements.article.replaceChildren();
    const heading = document.createElement("h1");
    heading.textContent = copy("loadFailed", "Documentation failed to load");
    const paragraph = document.createElement("p");
    paragraph.className = "docs-error";
    paragraph.textContent = message;
    elements.article.append(heading, paragraph);
    elements.status.hidden = false;
    elements.status.textContent = message;
  }

  /** Update the reading-progress bar. */
  function updateProgress() {
    const documentElement = document.documentElement;
    const total = documentElement.scrollHeight - window.innerHeight;
    const ratio = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
    elements.progress.style.width = `${(ratio * 100).toFixed(2)}%`;
  }

  /** Mark the table-of-contents row nearest the reading position. */
  function updateTocActive() {
    const headings = [...elements.article.querySelectorAll("h2[id], h3[id]")];
    if (!headings.length) {
      return;
    }
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 120) {
        current = heading;
      }
    }
    for (const link of elements.tocLinks.querySelectorAll("a")) {
      link.classList.toggle("is-active", link.dataset.anchor === current.id);
    }
  }

  /** Scroll to a page heading or the top after a route change. */
  function scrollToRoute(anchor) {
    window.requestAnimationFrame(() => {
      if (anchor) {
        const target = document.getElementById(anchor);
        if (target) {
          target.scrollIntoView({ block: "start" });
          updateTocActive();
          return;
        }
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  /** Build the in-page table of contents from rendered headings. */
  function renderToc(page) {
    elements.tocLinks.replaceChildren();
    const headings = page.headings.filter((heading) => heading.level >= 2 && heading.level <= 3);
    if (!headings.length) {
      elements.toc.hidden = true;
      return;
    }
    elements.toc.hidden = false;
    for (const heading of headings) {
      const link = document.createElement("a");
      link.href = hrefFor(page.route, heading.id);
      link.textContent = heading.text;
      link.dataset.route = page.route;
      link.dataset.anchor = heading.id;
      link.dataset.level = String(heading.level);
      elements.tocLinks.append(link);
    }
  }

  /** Build previous/next links from the flat reading order plus update time. */
  function renderPager(page) {
    elements.pager.replaceChildren();
    const index = state.pages.findIndex((candidate) => candidate.route === page.route);
    const previous = index > 0 ? state.pages[index - 1] : null;
    const next = index >= 0 && index < state.pages.length - 1 ? state.pages[index + 1] : null;
    if (previous) {
      const link = document.createElement("a");
      link.className = "docs-pager-previous";
      link.href = hrefFor(previous.route);
      link.dataset.route = previous.route;
      link.innerHTML = `<small>${copy("previous", "Previous")}</small>`;
      const strong = document.createElement("strong");
      strong.textContent = previous.title;
      link.append(strong);
      elements.pager.append(link);
    }
    if (next) {
      const link = document.createElement("a");
      link.className = "docs-pager-next";
      link.href = hrefFor(next.route);
      link.dataset.route = next.route;
      link.innerHTML = `<small>${copy("next", "Next")}</small>`;
      const strong = document.createElement("strong");
      strong.textContent = next.title;
      link.append(strong);
      elements.pager.append(link);
    }
    const updated = document.createElement("p");
    updated.className = "docs-updated";
    updated.textContent = `${copy("updated", "Updated")}${page.updated ?? "2026-11-04"}`;
    elements.pager.append(updated);
  }

  /** Wrap wide tables, add copy buttons, and resolve generated route links. */
  function decorateArticle() {
    for (const link of elements.article.querySelectorAll("a[data-route]")) {
      link.href = hrefFor(link.dataset.route, link.dataset.anchor ?? "");
    }
    for (const table of elements.article.querySelectorAll("table")) {
      const wrapper = document.createElement("div");
      wrapper.className = "docs-table-scroll";
      table.replaceWith(wrapper);
      wrapper.append(table);
    }
    for (const block of elements.article.querySelectorAll("pre")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-copy";
      button.textContent = copy("copy", "Copy");
      button.addEventListener("click", () => {
        const code = block.querySelector("code");
        const text = code ? code.textContent : block.textContent;
        const copy = navigator.clipboard?.writeText(text ?? "");
        if (!copy) {
          button.textContent = copy("copyFailed", "Copy failed");
          return;
        }
        void copy
          .then(() => {
            button.textContent = copy("copied", "Copied");
            window.setTimeout(() => {
              button.textContent = copy("copy", "Copy");
            }, 1400);
          })
          .catch(() => {
            button.textContent = copy("copyFailed", "Copy failed");
          });
      });
      block.append(button);
    }
  }

  /** Render one page and update every shell region. */
  function renderPage(route, anchor) {
    const page = state.byRoute.get(route);
    if (!page) {
      renderNotFound(route);
      return;
    }
    state.activeRoute = page.route;
    expandRouteAncestors(page.route);
    document.title = `${page.title}, ${state.content?.title ?? "RPE Redux Extension SDK"}`;
    elements.article.innerHTML = page.html;
    decorateArticle();
    elements.crumbs.replaceChildren();
    const breadcrumb = page.breadcrumb ?? [page.section, page.title];
    breadcrumb.filter(Boolean).forEach((part, index) => {
      if (index > 0) {
        elements.crumbs.append(" / ");
      }
      const span = document.createElement("span");
      span.textContent = part;
      elements.crumbs.append(span);
    });
    renderToc(page);
    renderPager(page);
    closeMenu();
    hideSearch();
    renderNav();
    scrollToRoute(anchor);
    updateProgress();
  }

  /** Render the unknown-page state without trusting the requested route. */
  function renderNotFound(route) {
    state.activeRoute = "";
    elements.article.replaceChildren();
    const heading = document.createElement("h1");
    heading.textContent = copy("notFound", "Page not found");
    const paragraph = document.createElement("p");
    paragraph.textContent = `${copy("notFoundDetail", "No page matches: ")}${route}`;
    const link = document.createElement("a");
    link.href = hrefFor(state.pages[0]?.route ?? "");
    link.dataset.route = state.pages[0]?.route ?? "";
    link.textContent = copy("returnStart", "Back to getting started");
    paragraph.append(" ", link);
    elements.article.append(heading, paragraph);
    elements.crumbs.replaceChildren();
    elements.pager.replaceChildren();
    elements.toc.hidden = true;
    document.title = `${copy("notFound", "Page not found")}, ${state.content?.title ?? "RPE Redux Extension SDK"}`;
    closeMenu();
    hideSearch();
    renderNav();
  }

  /** Scroll the requested heading into view after a same-page navigation. */
  function handleRoute() {
    const route = parseRoute();
    const targetRoute = route.route || state.pages[0]?.route || "";
    if (!targetRoute) {
      return;
    }
    if (targetRoute === state.activeRoute && route.anchor) {
      const target = document.getElementById(route.anchor);
      if (target) {
        target.scrollIntoView({ block: "start" });
        updateTocActive();
        closeMenu();
        hideSearch();
        return;
      }
    }
    renderPage(targetRoute, route.anchor);
  }

  /** Rank pages by title, keywords, headings, and body text. */
  function searchPages(query) {
    const tokens = tokenize(query);
    if (!tokens.length) {
      return [];
    }
    const matches = [];
    for (const page of state.pages) {
      const title = page.title.toLocaleLowerCase();
      const keywords = (page.keywords ?? []).join(" ").toLocaleLowerCase();
      const headings = (page.headings ?? [])
        .map((heading) => heading.text)
        .join(" ")
        .toLocaleLowerCase();
      const text = (page.text ?? "").toLocaleLowerCase();
      let score = 0;
      let matchedAll = true;
      for (const token of tokens) {
        const inTitle = title.includes(token);
        const inKeywords = keywords.includes(token);
        const inHeadings = headings.includes(token);
        const textIndex = text.indexOf(token);
        if (!inTitle && !inKeywords && !inHeadings && textIndex === -1) {
          matchedAll = false;
          break;
        }
        if (inTitle) {
          score += 100;
        }
        if (inKeywords) {
          score += 40;
        }
        if (inHeadings) {
          score += 20;
        }
        if (textIndex >= 0) {
          score += 8 + Math.min(6, text.split(token).length - 1) * 2;
        }
      }
      if (!matchedAll) {
        continue;
      }
      const firstMatch = Math.min(
        ...tokens.map((token) => text.indexOf(token)).filter((index) => index >= 0),
      );
      const start = Number.isFinite(firstMatch) ? Math.max(0, firstMatch - 56) : 0;
      const snippet = (page.text ?? "").slice(start, start + 170);
      matches.push({
        page,
        score,
        snippet: `${start > 0 ? "…" : ""}${snippet}${start + 170 < (page.text ?? "").length ? "…" : ""}`,
      });
    }
    return matches.sort((left, right) => right.score - left.score).slice(0, 20);
  }

  /** Append text to a result row, wrapping every token occurrence in `mark`. */
  function appendHighlighted(parent, text, tokens) {
    if (!tokens.length) {
      parent.append(text);
      return;
    }
    const expression = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "giu");
    const ranges = [];
    for (const match of text.matchAll(expression)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start < cursor) {
        continue;
      }
      if (start > cursor) {
        parent.append(text.slice(cursor, start));
      }
      const mark = document.createElement("mark");
      mark.textContent = text.slice(start, end);
      parent.append(mark);
      cursor = end;
    }
    if (cursor < text.length) {
      parent.append(text.slice(cursor));
    }
  }

  /** Paint the search result list and reveal every matching nav path. */
  function renderSearchResults(query) {
    state.results = searchPages(query);
    state.selected = 0;
    elements.searchResults.replaceChildren();
    if (!query.trim()) {
      hideSearch();
      return;
    }
    const routes = state.results.map((result) => result.page.route);
    state.searchRoutes = new Set(routes);
    state.searchExpandedIds = collectSearchExpanded(routes);
    state.searchActive = routes.length > 0;
    renderNav();
    elements.searchResults.hidden = false;
    elements.searchInput.setAttribute("aria-expanded", "true");
    if (!state.results.length) {
      const empty = document.createElement("p");
      empty.className = "docs-search-empty";
      empty.textContent = copy("noSearchResults", "No matching pages.");
      elements.searchResults.append(empty);
      return;
    }
    const tokens = tokenize(query);
    state.results.forEach((result, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-search-result";
      button.role = "option";
      button.dataset.slug = result.page.slug;
      button.dataset.route = result.page.route;
      button.setAttribute("aria-selected", index === state.selected ? "true" : "false");
      const title = document.createElement("strong");
      appendHighlighted(title, result.page.title, tokens);
      const section = document.createElement("small");
      section.textContent = (result.page.breadcrumb ?? [result.page.section]).join(" / ");
      const snippet = document.createElement("span");
      appendHighlighted(snippet, result.snippet, tokens);
      button.append(title, section, snippet);
      button.addEventListener("click", () => {
        navigate(result.page.route);
      });
      elements.searchResults.append(button);
    });
  }

  /** Hide the popover and restore the expansion state from before the search. */
  function hideSearch(restoreNav = true) {
    const wasActive = state.searchActive;
    elements.searchResults.hidden = true;
    elements.searchInput.setAttribute("aria-expanded", "false");
    state.results = [];
    state.selected = 0;
    state.searchActive = false;
    state.searchRoutes = new Set();
    state.searchExpandedIds = new Set();
    if (wasActive && restoreNav && state.content) {
      renderNav();
    }
  }

  /** Move the visual selection inside the result list. */
  function selectResult(index) {
    if (!state.results.length) {
      return;
    }
    state.selected = (index + state.results.length) % state.results.length;
    const buttons = [...elements.searchResults.querySelectorAll(".docs-search-result")];
    buttons.forEach((button, buttonIndex) => {
      button.setAttribute("aria-selected", buttonIndex === state.selected ? "true" : "false");
    });
    buttons[state.selected]?.scrollIntoView({ block: "nearest" });
  }

  /** Run the debounced search when the user types. */
  function scheduleSearch() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      renderSearchResults(elements.searchInput.value);
    }, 120);
  }

  /** Toggle the narrow-screen navigation drawer. */
  function toggleMenu() {
    const open = !document.body.classList.contains("docs-menu-open");
    document.body.classList.toggle("docs-menu-open", open);
    elements.menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    elements.backdrop.hidden = !open;
  }

  /** Close the narrow-screen navigation drawer. */
  function closeMenu() {
    if (!document.body.classList.contains("docs-menu-open")) {
      return;
    }
    document.body.classList.remove("docs-menu-open");
    elements.menuToggle.setAttribute("aria-expanded", "false");
    elements.backdrop.hidden = true;
  }

  /** Switch the rendered documentation payload while preserving the current route. */
  function applyLocale(locale, replaceRoute = false) {
    const payload = state.catalog?.[locale];
    if (!payload) {
      return;
    }
    const route = parseRoute();
    state.locale = locale;
    state.content = payload;
    state.navById.clear();
    state.navAncestors.clear();
    flattenPages(payload);
    indexNav(payload.nav);
    setLocaleMenuOpen(false);
    applyShellCopy();
    renderNav();
    const target = route.route || state.pages[0]?.route || "";
    if (replaceRoute || !route.route) {
      navigate(target, route.anchor, true);
    } else {
      handleRoute();
    }
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Locale selection still applies when storage is unavailable.
    }
  }

  /** Attach every shell event listener. */
  function bindEvents() {
    elements.menuToggle.addEventListener("click", toggleMenu);
    elements.backdrop.addEventListener("click", closeMenu);
    elements.localeToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setLocaleMenuOpen(elements.localeMenu.hidden);
    });
    elements.localeMenu.addEventListener("click", (event) => {
      const option =
        event.target instanceof Element ? event.target.closest("button[data-locale]") : null;
      if (option?.dataset.locale) {
        applyLocale(option.dataset.locale);
      }
    });
    elements.searchInput.addEventListener("input", scheduleSearch);
    elements.searchInput.addEventListener("focus", () => {
      if (elements.searchInput.value.trim()) {
        renderSearchResults(elements.searchInput.value);
      }
    });
    elements.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectResult(state.selected + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        selectResult(state.selected - 1);
      } else if (event.key === "Enter") {
        const result = state.results[state.selected];
        if (result) {
          event.preventDefault();
          navigate(result.page.route);
          elements.searchInput.value = "";
          hideSearch();
        }
      } else if (event.key === "Escape") {
        elements.searchInput.value = "";
        hideSearch();
        elements.searchInput.blur();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!elements.search.contains(event.target)) {
        const wasActive = state.searchActive;
        hideSearch(false);
        if (wasActive) {
          window.setTimeout(() => {
            if (!state.searchActive) {
              renderNav();
            }
          }, 0);
        }
      }
      if (!(event.target instanceof Element) || !event.target.closest(".docs-locale-picker")) {
        setLocaleMenuOpen(false);
      }
    });
    document.addEventListener("click", (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const typeLink =
        event.target instanceof Element ? event.target.closest("[data-type-id]") : null;
      if (typeLink) {
        event.preventDefault();
        openTypeInspector(typeLink.dataset.typeId ?? "");
        return;
      }
      const link = event.target instanceof Element ? event.target.closest("a[data-route]") : null;
      if (!link) {
        return;
      }
      event.preventDefault();
      navigate(link.dataset.route ?? "", link.dataset.anchor ?? "");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
        closeTypeInspector();
        setLocaleMenuOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        elements.searchInput.focus();
        elements.searchInput.select();
        return;
      }
      const target = event.target;
      if (
        event.key === "/" &&
        target instanceof HTMLElement &&
        !target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        event.preventDefault();
        elements.searchInput.focus();
      }
    });
    window.addEventListener("popstate", handleRoute);
    window.addEventListener("hashchange", handleRoute);
    window.addEventListener("scroll", () => {
      updateProgress();
      updateTocActive();
    });
    window.addEventListener("resize", () => {
      updateProgress();
      if (window.innerWidth > 900) {
        closeMenu();
      }
    });
    elements.nav.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const toggle = event.target.closest("button[data-node-id]");
      if (toggle) {
        event.preventDefault();
        toggleNavNode(toggle);
        return;
      }
      if (event.target.closest("a")) {
        closeMenu();
      }
    });
    elements.pager.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) {
        closeMenu();
      }
    });
  }

  /** Resolve the best supported locale from the browser's ordered language list. */
  function browserPreferredLocale(catalog) {
    const languages = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ].filter(Boolean);
    const locales = Object.keys(catalog ?? {});
    for (const language of languages) {
      const normalized = String(language).toLowerCase();
      const exact = locales.find((locale) => {
        const htmlLang = String(catalog[locale]?.htmlLang ?? locale).toLowerCase();
        return htmlLang === normalized || locale.toLowerCase() === normalized;
      });
      if (exact) {
        return exact;
      }
      const base = normalized.split("-")[0];
      const languageMatch = locales.find((locale) => {
        const htmlLang = String(catalog[locale]?.htmlLang ?? locale).toLowerCase();
        return htmlLang.split("-")[0] === base || locale.toLowerCase().split("-")[0] === base;
      });
      if (languageMatch) {
        return languageMatch;
      }
    }
    return "";
  }

  /** Load content and start the router. */
  async function start() {
    elements.nav = byId("docs-nav");
    elements.search = document.querySelector(".docs-search");
    elements.searchInput = byId("docs-search");
    elements.searchResults = byId("docs-search-results");
    elements.article = byId("docs-article");
    elements.crumbs = byId("docs-crumbs");
    elements.pager = byId("docs-pager");
    elements.toc = byId("docs-toc");
    elements.tocLinks = byId("docs-toc-links");
    elements.progress = byId("docs-progress-bar");
    elements.menuToggle = byId("docs-menu-toggle");
    elements.localeToggle = byId("docs-locale-toggle");
    elements.localeCurrent = byId("docs-locale-current");
    elements.localeMenu = byId("docs-locale-menu");
    elements.sidebar = byId("docs-sidebar");
    elements.backdrop = byId("docs-sidebar-backdrop");
    elements.status = byId("docs-status");
    showLoading();
    try {
      const response = await fetch(`${docsBase()}content.json`, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`content.json 返回 HTTP ${response.status}`);
      }
      const content = await response.json();
      if (!Array.isArray(content.sections) || !Array.isArray(content.nav)) {
        throw new Error("content.json 缺少 sections 或 nav");
      }
      state.catalog = content.locales ?? { [content.locale ?? "zh"]: content };
      const browserLocale = browserPreferredLocale(state.catalog);
      let preferredLocale = "";
      try {
        preferredLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY) ?? "";
      } catch {
        preferredLocale = "";
      }
      const initialLocale = state.catalog[browserLocale]
        ? browserLocale
        : state.catalog[preferredLocale]
          ? preferredLocale
          : (content.defaultLocale ?? "zh");
      state.content = state.catalog[initialLocale];
      state.locale = initialLocale;
      flattenPages(state.content);
      indexNav(state.content.nav);
      state.navExpanded = readNavExpanded();
      applyShellCopy();
      const route = parseRoute();
      const initialRoute = route.route || state.pages[0]?.route || "";
      expandRouteAncestors(initialRoute);
      renderNav();
      bindEvents();
      if (!route.route) {
        navigate(state.pages[0]?.route ?? "", "", true);
      } else {
        handleRoute();
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  void start();
})();
