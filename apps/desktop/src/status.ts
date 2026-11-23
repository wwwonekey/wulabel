import type { ImageStatus } from "./api";
import { t } from "./i18n";

/** 图片状态在界面上怎么显示。
 *  团队协作（审核流程）时：标注员提交的叫「待审核」，审核员通过的叫「已通过」；
 *  一个人标注时没有审核这一步，已审核的也显示成「已标注」。 */
export const statusTag = (s: ImageStatus, review: boolean): { text: string; color?: string } => {
  switch (s) {
    case "labeled":
      return { text: review ? t("待审核") : t("已标注"), color: "processing" };
    case "reviewed":
      return review ? { text: t("已通过"), color: "success" } : { text: t("已标注"), color: "processing" };
    case "skipped":
      return { text: t("已跳过") };
    default:
      return { text: t("未标注") };
  }
};
