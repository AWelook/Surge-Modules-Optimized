/***********************************************
> 应用名称：墨鱼自用12306去广告脚本
> 脚本作者：@ddgksf2013
> 微信账号：墨鱼手记
> 更新时间：2024-08-24
> 通知频道：https://t.me/ddgksf2021
> 特别提醒：如需转载请注明出处，谢谢合作！
***********************************************/

const placementNo = JSON.parse($request.body).placementNo;
let payload;

if ("0007" == placementNo) {
  payload = {
    materialsList: [
      {
        billMaterialsId: "6491",
        filePath: "ddgksf2013",
        creativeType: 1,
      },
    ],
    advertParam: { skipTime: 1 },
    code: "00",
  };
} else if ("G0054" == placementNo) {
  payload = { code: "00", materialsList: [{}] };
} else {
  payload = { code: "00", message: "无广告返回" };
}

const body = JSON.stringify(payload);
if (typeof $task !== "undefined") {
  $done({ body });
} else {
  $done({ response: { body } });
}
