// ==UserScript==
// @name         Youtube Auto-translate Canceler
// @namespace    https://github.com/ibnunes/YoutubeAutotranslateCanceler
// @version      0.5
// @description  Remove auto-translated youtube titles
// @author       Pierre Couy
// @match        https://www.youtube.com/*
// @grant        GM.setValue
// @grant        GM.getValue
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js
// ==/UserScript==

(async () => {
    'use strict';

    /*
    Get a YouTube Data v3 API key from https://console.developers.google.com/apis/library/youtube.googleapis.com?q=YoutubeData
    */
    let NO_API_KEY = false;
    let api_key_awaited = await GM.getValue("api_key");
    if (api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === "") {
        await GM.setValue("api_key", prompt("Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key."));
    }

    api_key_awaited = await GM.getValue("api_key");
    if (api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === "") {
        NO_API_KEY = true; // Resets after page reload, still allows local title to be replaced
        console.log("Youtube Auto-translate Canceler: NO API KEY PRESENT");
    }
    const API_KEY = await GM.getValue("api_key");
    let API_KEY_VALID = false;
    // console.log(API_KEY);
    console.log("Youtube Auto-translate Canceler: Got API key");

    const URL_TEMPLATE = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id={IDs}&key=" + API_KEY;

    // Dictionary(id, title): Cache of API fetches, survives only Youtube Autoplay
    let cachedTitles = {}
    // (id, desc linkified TrustedHTML)
    let cachedDescriptions = {}


    function videoIdFromUrl(url_string) {
        const url = new URL(url_string);
        if (url.pathname.includes("/watch")) {
            return url.searchParams.get('v') || null;
        }
        if (url.pathname.includes("/shorts")) {
            const splits = url.pathname.split('/');
            return splits.length >= 3 ? splits[2] : null;
        }
        return null;
    }

    function videoIdFromA(a) {
        while (a.tagName != "A") {
            a = a.parentNode;
        }
        if (!a || !a.href) return null;
        return videoIdFromUrl(a.href);
    }

    function collectVideoElements() {
        let links = Array
            .from(document.querySelectorAll(
                'a[href*="/watch"] span[role="text"], '
                + 'a[href*="/watch"] span#video-title, '
                + 'a[href*="/shorts"] span[role="text"], '
                + 'a[href*="/shorts"] span#video-title'))
            .filter(a => { return a.textContent?.trim().length > 0; });
        return links;
    }

    async function fetchVideoData(videoIDs) {
        if (videoIDs.length === 0) return;

        const requestUrl = URL_TEMPLATE.replace("{IDs}", videoIDs.join(','));

        // Issue API request
        let data;
        try {
            data = await fetch(requestUrl).then((r) => r.json());
        } catch (err) {
            console.log("Exception while fetching:", err);
        }

        if (!data || data.kind !== "youtube#videoListResponse") {
            console.log("API Request Failed!", requestUrl, data);

            // This ensures that occasional fails don't stall the script
            // But if the first query is a fail then it won't try repeatedly
            NO_API_KEY = !API_KEY_VALID;
            if (NO_API_KEY) {
                console.log("API Key Fail! Please Reload!");
            }

            return;
        }
        API_KEY_VALID = true;

        // Create dictionary for all IDs and their original titles
        for (const v of data.items) {
            cachedTitles[v.id] = v.snippet.title;
            cachedDescriptions[v.id] = DOMPurify.sanitize(
                linkify(v.snippet.description), { RETURN_TRUSTED_TYPE: true });
        }
    }

    function updateMainVideo(mainVidID) {
        if (!mainVidID) return;

        // Replace Main Video title
        const untranslatedTitle = cachedTitles[mainVidID]

        const mainTitle = document.querySelector('#title > h1 > yt-formatted-string');
        if (mainTitle
            && untranslatedTitle
            && (mainTitle.innerText !== untranslatedTitle
                || mainTitle.getAttribute('is-empty') !== null)) {
            mainTitle.innerText = untranslatedTitle
            mainTitle.title = untranslatedTitle
            mainTitle.removeAttribute('is-empty')
            document.title = `${untranslatedTitle} - YouTube`
        }

        const shortsTitle = document.querySelector('#metapanel span[role="text"]');
        if (shortsTitle
            && untranslatedTitle
            && (shortsTitle.innerText !== untranslatedTitle
                || shortsTitle.getAttribute('is-empty') !== null)) {
            shortsTitle.innerText = untranslatedTitle
            shortsTitle.title = untranslatedTitle
            shortsTitle.removeAttribute('is-empty')
            document.title = `${untranslatedTitle} - YouTube`
        }

        // Replace Main Video Description
        const videoDescription = cachedDescriptions[mainVidID];
        const pageDescription = document
            .querySelector('#description-inline-expander yt-attributed-string > span')
        // Still critical, since it replaces ALL descriptions, even if it was not translated in the first place (no easy comparision possible)
        if (videoDescription && pageDescription.innerHTML !== videoDescription.toString()) {
            pageDescription.innerHTML = videoDescription;
        }
    }

    function updateAllLinkTitles(links, IDs) {
        // Change all previously found link elements
        for (let i = 0; i < links.length; i++) {
            const curID = videoIdFromA(links[i]);
            if (!curID) continue;

            if (curID !== IDs[i]) {
                // Can happen when Youtube was still loading when script was invoked
                console.log("YouTube was too slow again...");
                continue;
            }

            const originalTitle = cachedTitles[curID];
            if (!originalTitle) continue;

            const linkEl = links[i].querySelector('#video-title') || links[i]
            const pageTitle = linkEl.innerText.trim();

            if (pageTitle === originalTitle.replace(/\s{2,}/g, ' ')
                || pageTitle === originalTitle) continue;

            console.log("'" + pageTitle + "' --> '" + originalTitle + "'");
            linkEl.textContent = originalTitle;
            linkEl.title = originalTitle;
        }
    }

    async function changeTitles() {
        if (NO_API_KEY) return;

        const links = collectVideoElements();
        const mainVidID = videoIdFromUrl(window.location.href);

        const IDs = [...links.map(a => videoIdFromA(a)), ...(mainVidID ? [mainVidID] : [])];
        const APIFetchIDs = IDs
            .filter(id => !cachedTitles[id] || !cachedDescriptions[id])
            .slice(0, 30);

        if (IDs.length == 0) return;

        await fetchVideoData(APIFetchIDs);

        // Begin to update the DOM
        updateMainVideo(mainVidID);
        updateAllLinkTitles(links, IDs);
    }

    // linkify replaces links correctly, but without redirect or other specific youtube
    // stuff (no problem if missing)
    function linkify(inputText) {
        let replacedText, replacePattern1, replacePattern2, replacePattern3;

        //URLs starting with http://, https://, or ftp://
        replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
        replacedText = inputText.replace(replacePattern1, '<a class="yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color" spellcheck="false" href="$1">$1</a>');

        //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
        replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
        replacedText = replacedText.replace(replacePattern2, '<a class="yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color" spellcheck="false" href="http://$1">$1</a>');

        //Change email addresses to mailto:: links.
        replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
        replacedText = replacedText.replace(replacePattern3, '<a class="yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color" spellcheck="false" href="mailto:$1">$1</a>');

        replacedText = replacedText.replaceAll('\n', '<br />')

        return replacedText;
    }

    const observer = new MutationObserver(() => {
        changeTitles().catch(() => { })
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();

