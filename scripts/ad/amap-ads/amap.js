/***********************************************
> 应用名称：墨鱼自用高德地图去广告脚本
> 脚本作者：@ddgksf2013
> 微信账号：墨鱼手记
> 更新时间：2025-08-30
> 通知频道：https://t.me/ddgksf2021
> 贡献投稿：https://t.me/ddgksf2013_bot
> 问题反馈：ddgksf2013@163.com
> 特别提醒：如需转载请注明出处，谢谢合作！
***********************************************/

const url = $request.url;
const response = JSON.parse($response.body);

if (url.indexOf("valueadded/alimama/splash_screen") !== -1) {
  if (response.data && response.data.ad) {
    for (const item of response.data.ad) {
      item.set.setting.display_time = 0;
      item.creative[0].start_time = 2240150400;
      item.creative[0].end_time = 2240150400;
    }
  }
  finish(response);
} else if (url.indexOf("faas/amap-navigation/main-page") !== -1) {
  if (response.data?.cardList) {
    response.data.cardList = Object.values(response.data.cardList).filter(
      (item) =>
        item.dataType === "LoginCard" ||
        item.dataType === "FrequentLocation",
    );
  }
  if (response.data?.pull3?.msgs) {
    response.data.pull3.msgs = [];
  }
  if (response.data?.business_position) {
    response.data.business_position = [];
  }
  if (response.data?.mapBizList) {
    response.data.mapBizList = [];
  }
  finish(response);
} else if (url.indexOf("profile/index/node") !== -1) {
  delete response.data.tipData;
  if (response.data?.cardList) {
    response.data.cardList = Object.values(response.data.cardList).filter(
      (item) =>
        item.dataType === "MyOrderCard" ||
        item.dataType === "GdRecommendCard",
    );
  }
  finish(response);
} else if (url.indexOf("new_hotword") !== -1) {
  if (response.data?.header_hotword) {
    response.data.header_hotword = [];
  }
  finish(response);
} else if (url.indexOf("ws/promotion-web/resource") !== -1) {
  const properties = ["icon", "banner", "tips", "popup", "bubble", "other"];
  for (const property of properties) {
    if (response.data?.[property]) {
      response.data[property] = [];
    }
  }
  finish(response);
} else if (url.indexOf("ws/msgbox/pull") !== -1) {
  if (response.msgs) {
    response.msgs = [];
  }
  if (response.pull3?.msgs) {
    response.pull3.msgs = [];
  }
  finish(response);
} else if (url.indexOf("ws/message/notice/list") !== -1) {
  if (response.data?.noticeList) {
    response.data.noticeList = [];
  }
  finish(response);
} else if (url.indexOf("ws/shield/frogserver/aocs") !== -1) {
  const keywordPattern =
    /gd_notch_logo|home_business_position_config|his_input_tip|operation_layer|aiNative|ai_|_ai/u;
  for (const key of Object.keys(response.data || {})) {
    if (keywordPattern.test(key)) {
      response.data[key] = { status: 1, version: "", value: "" };
    }
  }
  finish(response);
} else if (url.indexOf("search/nearbyrec_smart") !== -1) {
  const properties = [
    "coupon",
    "scene",
    "activity",
    "commodity_rec",
    "operation_activity",
  ];
  if (response.data) {
    for (const property of properties) {
      delete response.data[property];
    }
    if (response.data.modules) {
      response.data.modules = response.data.modules.filter(
        (item) => !properties.includes(item),
      );
    }
  }
  finish(response);
} else {
  $done({});
}

function finish(value) {
  $done({ body: JSON.stringify(value) });
}
