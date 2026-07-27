import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const moduleText = await readFile(
  new URL("../modules/ad/xiaohongshu-ads.sgmodule", import.meta.url),
  "utf8",
);
const upstreamText = await readFile(
  new URL("../upstream/ad/xiaohongshu-ads/module.sgmodule", import.meta.url),
  "utf8",
);
const upstreamScript = await readFile(
  new URL(
    "../upstream/ad/xiaohongshu-ads/RedPaper_remove_ads.js",
    import.meta.url,
  ),
  "utf8",
);
const optimizedScript = await readFile(
  new URL(
    "../scripts/ad/xiaohongshu-ads/RedPaper_remove_ads.js",
    import.meta.url,
  ),
  "utf8",
);
const jqAvailable =
  spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
const upstreamBodyRules = bodyRules(upstreamText);
const optimizedBodyRules = bodyRules(moduleText);
const upstreamScriptEntries = scriptEntries(upstreamText);
const optimizedScriptEntries = scriptEntries(moduleText);
const scriptUrls = [
  "https://edith.xiaohongshu.com/api/sns/v1/note/imagefeed",
  "https://edith.xiaohongshu.com/api/sns/v1/note/live_photo/save",
  "https://edith.xiaohongshu.com/api/sns/v1/system/service/ui/config?x=1",
  "https://edith.xiaohongshu.com/api/sns/v1/system_service/config?x=1",
  "https://edith.xiaohongshu.com/api/sns/v2/system_service/splash_config",
  "https://edith.xiaohongshu.com/api/sns/v2/note/widgets",
  "https://edith.xiaohongshu.com/api/sns/v2/user/followings/followfeed",
  "https://edith.xiaohongshu.com/api/sns/v4/followfeed?x=1",
  "https://edith.xiaohongshu.com/api/sns/v5/recommend/user/follow_recommend?x=1",
  "https://edith.xiaohongshu.com/api/sns/v1/interaction/comment/video/download",
  "https://edith.xiaohongshu.com/api/sns/v5/note/comment/list",
  "https://edith.xiaohongshu.com/api/sns/v2/note/feed",
  "https://edith.xiaohongshu.com/api/sns/v3/note/videofeed",
  "https://edith.xiaohongshu.com/api/sns/v6/homefeed?x=1",
  "https://rec.xiaohongshu.com/api/sns/v6/homefeed?x=1",
  "https://edith.xiaohongshu.com/api/sns/v10/search/notes?x=1",
  "https://so.xiaohongshu.com/api/sns/v10/search/notes?x=1",
  "https://edith.xiaohongshu.com/api/sns/v4/note/videofeed",
  "https://rec.xiaohongshu.com/api/sns/v10/note/video/save",
  "https://www.xiaohongshu.com/api/sns/v10/note/video/save",
];

test("registers an exact native Surge upstream and rehosts its script", () => {
  assert.match(upstreamText, /^#!name=小红书去广告$/mu);
  assert.equal(upstreamScriptEntries.length, 12);
  assert.equal(optimizedScriptEntries.length, 1);
  assert.match(
    optimizedScriptEntries[0].line,
    /script-path=https:\/\/raw\.githubusercontent\.com\/AWelook\/Surge-Modules-Optimized\/refs\/heads\/main\/scripts\/ad\/xiaohongshu-ads\/RedPaper_remove_ads\.js/u,
  );
  assert.doesNotMatch(moduleText, /script-path=https:\/\/kelee\.one/u);
  assert.doesNotMatch(optimizedScriptEntries[0].line, /max-size=/u);
});

test("preserves Rule, Map Local, and MITM behavior exactly", () => {
  for (const sectionName of ["Rule", "Map Local", "MITM"]) {
    assert.equal(
      section(moduleText, sectionName).trim(),
      section(upstreamText, sectionName).trim(),
    );
  }
  assert.equal(functionalLines(section(moduleText, "Map Local")).length, 5);
});

test("merged script registration covers every original endpoint exactly once", () => {
  for (const url of scriptUrls) {
    assert.equal(countMatches(upstreamScriptEntries, url), 1, url);
    assert.equal(countMatches(optimizedScriptEntries, url), 1, url);
  }
  for (const url of [
    "http://edith.xiaohongshu.com/api/sns/v1/note/imagefeed",
    "https://example.com/api/sns/v6/homefeed?x=1",
    "https://edith.xiaohongshu.com/api/sns/v9/unrelated",
  ]) {
    assert.equal(countMatches(optimizedScriptEntries, url), 0, url);
  }
});

test("only the two script hot paths differ from upstream", () => {
  const expected = upstreamScript
    .replace(
      "  let newDatas = [];\n  if (obj?.data?.[0]?.note_list?.length > 0) {",
      "  let newDatas = [];\n  let shouldWriteLivePhotos = false;\n  if (obj?.data?.[0]?.note_list?.length > 0) {",
    )
    .replace(
      '          if (i.hasOwnProperty("live_photo_file_id") && i.hasOwnProperty("live_photo")) {\n            if (',
      '          if (i.hasOwnProperty("live_photo_file_id") && i.hasOwnProperty("live_photo")) {\n            shouldWriteLivePhotos = true;\n            if (',
    )
    .replace(
      '            // 写入持久化存储\n            $persistentStore.write(JSON.stringify(newDatas), "redBookLivePhoto");\n',
      "",
    )
    .replace(
      '    }\n  }\n} else if (url.includes("/v1/note/live_photo/save")) {',
      '    }\n  }\n  if (shouldWriteLivePhotos) {\n    // 原脚本在图片循环内重复写入；最终存储值不变时只写一次\n    $persistentStore.write(JSON.stringify(newDatas), "redBookLivePhoto");\n  }\n} else if (url.includes("/v1/note/live_photo/save")) {',
    )
    .replace(
      '      obj.data = modDatas;\n    }\n    $persistentStore.write(JSON.stringify(newDatas), "redBookVideoFeed");',
      '    }\n    obj.data = modDatas;\n    $persistentStore.write(JSON.stringify(newDatas), "redBookVideoFeed");',
    )
    .replace(
      "        for (const sub_comment of comment.sub_comments) {\n          if (comment?.comment_type === 3) {\n            comment.comment_type = 2;\n          }\n          if (comment?.media_source_type === 1) {\n            comment.media_source_type = 0;",
      "        for (const sub_comment of comment.sub_comments) {\n          if (sub_comment?.comment_type === 3) {\n            sub_comment.comment_type = 2;\n          }\n          if (sub_comment?.media_source_type === 1) {\n            sub_comment.media_source_type = 0;",
    );
  assert.equal(optimizedScript, expected);
});

test("image-feed output and final storage stay equal with one optimized write", () => {
  const input = {
    data: [
      {
        note_list: [
          {
            images_list: [
              {
                live_photo_file_id: "a",
                live_photo: {
                  media: {
                    video_id: "video-a",
                    stream: { h265: [{ master_url: "https://a/a.mp4" }] },
                  },
                },
              },
              {
                live_photo_file_id: "b",
                live_photo: {
                  media: {
                    video_id: "video-b",
                    stream: { h265: [{ master_url: "https://b/b.mp4" }] },
                  },
                },
              },
              { live_photo_file_id: null, live_photo: {} },
            ],
          },
        ],
      },
    ],
  };
  const url = "https://edith.xiaohongshu.com/api/sns/v1/note/imagefeed";
  const upstream = runScript(upstreamScript, url, input);
  const optimized = runScript(optimizedScript, url, input);
  assert.deepEqual(optimized.output, upstream.output);
  assert.deepEqual(optimized.store, upstream.store);
  assert.equal(upstream.writes.length, 3);
  assert.equal(optimized.writes.length, 1);
});

test("video-feed loop assignment optimization is output-equivalent", () => {
  const input = {
    data: [
      {
        id: "normal",
        model_type: "note",
        video_info_v2: {
          media: {
            stream: { h265: [{ master_url: "https://video/normal.mp4" }] },
          },
        },
      },
      { id: "ad", model_type: "note", ad: { id: 1 } },
      { id: "other", model_type: "live" },
    ],
  };
  const url =
    "https://edith.xiaohongshu.com/api/sns/v4/note/videofeed";
  const upstream = runScript(upstreamScript, url, input);
  const optimized = runScript(optimizedScript, url, input);
  assert.deepEqual(optimized, upstream);
});

test("sub-comment media flags are normalized on the sub-comment itself", () => {
  const input = {
    data: {
      comments: [
        {
          note_id: "note-1",
          comment_type: 0,
          media_source_type: 0,
          sub_comments: [
            {
              id: "sub-1",
              comment_type: 3,
              media_source_type: 1,
              pictures: [],
            },
          ],
        },
      ],
    },
  };
  const url =
    "https://edith.xiaohongshu.com/api/sns/v5/note/comment/list";
  const upstream = JSON.parse(
    runScript(upstreamScript, url, input).output.body,
  );
  const optimized = JSON.parse(
    runScript(optimizedScript, url, input).output.body,
  );

  assert.equal(upstream.data.comments[0].comment_type, 0);
  assert.equal(upstream.data.comments[0].media_source_type, 0);
  assert.equal(upstream.data.comments[0].sub_comments[0].comment_type, 3);
  assert.equal(
    upstream.data.comments[0].sub_comments[0].media_source_type,
    1,
  );

  assert.equal(optimized.data.comments[0].comment_type, 0);
  assert.equal(optimized.data.comments[0].media_source_type, 0);
  assert.equal(optimized.data.comments[0].sub_comments[0].comment_type, 2);
  assert.equal(
    optimized.data.comments[0].sub_comments[0].media_source_type,
    0,
  );
});

test("unchanged script routes retain byte-equivalent responses and stores", () => {
  for (const url of scriptUrls) {
    const upstream = runScript(upstreamScript, url, { data: {} });
    const optimized = runScript(optimizedScript, url, { data: {} });
    assert.deepEqual(optimized, upstream, url);
  }
});

test("merges only the duplicate trending jq pass", () => {
  assert.equal(upstreamBodyRules.length, 5);
  assert.equal(optimizedBodyRules.length, 4);
  assert.deepEqual(
    optimizedBodyRules.map(({ pattern }) => pattern),
    [...new Set(upstreamBodyRules.map(({ pattern }) => pattern))],
  );
  for (const optimized of optimizedBodyRules) {
    const originals = upstreamBodyRules.filter(
      ({ pattern }) => pattern === optimized.pattern,
    );
    if (originals.length === 1) {
      assert.equal(optimized.filter, originals[0].filter);
    }
  }
});

test(
  "merged trending jq preserves sequential upstream output",
  { skip: !jqAvailable },
  () => {
    const pattern =
      String.raw`^https:\/\/edith\.xiaohongshu\.com\/api\/sns\/v4\/search\/trending\?`;
    const upstreamFilters = upstreamBodyRules
      .filter((rule) => rule.pattern === pattern)
      .map(({ filter }) => filter);
    const optimizedFilter = optimizedBodyRules.find(
      (rule) => rule.pattern === pattern,
    )?.filter;
    assert.equal(upstreamFilters.length, 2);
    assert.ok(optimizedFilter);
    for (const fixture of [
      { data: { queries: [1], hint_word: { text: "ad" }, keep: true } },
      { data: { queries: [], keep: true } },
      { data: { hint_word: null, keep: true } },
      { data: { other: true } },
    ]) {
      assert.deepEqual(
        runJq(optimizedFilter, fixture),
        runJqSequence(upstreamFilters, fixture),
      );
    }
  },
);

function section(text, name) {
  const marker = `[${name}]`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const contentStart = start + marker.length;
  const next = text.indexOf("\n[", contentStart);
  return text.slice(contentStart, next === -1 ? text.length : next);
}

function functionalLines(content) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function bodyRules(text) {
  return functionalLines(section(text, "Body Rewrite")).map((line) => {
    const match = line.match(/^http-response-jq\s+(.+?)\s+'(.+)'$/u);
    assert.ok(match, `Unable to parse Body Rewrite rule: ${line}`);
    return { pattern: match[1], filter: match[2] };
  });
}

function scriptEntries(text) {
  return functionalLines(section(text, "Script")).map((line) => {
    const match = line.match(
      /pattern=(?:"([^"]+)"|(.+?)),\s*script-path=/u,
    );
    assert.ok(match, `Unable to parse Script rule: ${line}`);
    return { line, pattern: match[1] ?? match[2] };
  });
}

function countMatches(entries, url) {
  return entries.filter(({ pattern }) => new RegExp(pattern, "u").test(url))
    .length;
}

function runScript(script, url, input, initialStore = {}) {
  const store = new Map(
    Object.entries(initialStore).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
  const writes = [];
  let output;
  vm.runInNewContext(
    script,
    {
      $request: { url },
      $response: { body: JSON.stringify(input) },
      $persistentStore: {
        read: (key) => store.get(key) ?? null,
        write: (value, key) => {
          store.set(key, value);
          writes.push({ key, value });
          return true;
        },
      },
      $done: (value) => {
        output = value;
      },
    },
    { timeout: 1_000 },
  );
  return JSON.parse(
    JSON.stringify({
      output,
      store: Object.fromEntries(store),
      writes,
    }),
  );
}

function runJq(filter, input) {
  const result = spawnSync("jq", ["-c", filter], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runJqSequence(filters, input) {
  return filters.reduce((value, filter) => runJq(filter, value), input);
}
