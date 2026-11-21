import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, InputNumber, Modal, Pagination, Segmented, Space, Tag } from "antd";
import { api, errText, ImageItem, ProjectInfo, SplitSummary, thumbUrl } from "../api";
import { useApp } from "../store";
import { t } from "../i18n";

type SplitKey = "train" | "val" | "test" | "unset";
const PAGE = 60;

/** 训练页「查看和调整」：看每张已标注的图在训练集、验证集还是测试集，手动移动，或按比例重新分配 */
export default function SplitModal({
  project,
  review,
  open,
  ratios,
  onRatios,
  onClose,
  onChanged,
}: {
  project: ProjectInfo;
  /** 用不用审核流程（不用时已审核的图也显示成已标注） */
  review: boolean;
  open: boolean;
  /** 未划分的图开始训练时按这个比例分配（小数，和训练参数里的一样） */
  ratios: [number, number, number];
  onRatios: (r: [number, number, number]) => void;
  onClose: () => void;
  onChanged: (s: SplitSummary) => void;
}) {
  const { message, modal } = App.useApp();
  const annotateImage = useApp((s) => s.annotateImage);
  const [tab, setTab] = useState<SplitKey>("train");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sum, setSum] = useState<SplitSummary | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const pct = ratios.map((r) => Math.round(r * 100)) as [number, number, number];

  const load = useCallback(async () => {
    const [pg, s] = await Promise.all([api.listSplitImages(tab, (page - 1) * PAGE, PAGE), api.splitSummary()]);
    // 移走后这一页空了，退回上一页
    if (pg.items.length === 0 && page > 1) {
      setPage(Math.max(1, Math.ceil(pg.total / PAGE)));
      return;
    }
    setItems(pg.items);
    setTotal(pg.total);
    setSum(s);
    onChanged(s);
  }, [tab, page, onChanged]);

  useEffect(() => {
    if (open) load().catch((e) => message.error(errText(e)));
  }, [open, load, message]);

  useEffect(() => {
    if (!open) setPicked(new Set());
  }, [open]);

  const switchTab = (k: SplitKey) => {
    setTab(k);
    setPage(1);
    setPicked(new Set());
  };

  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const move = async (to: Exclude<SplitKey, "unset">) => {
    setBusy(true);
    try {
      await api.setSplit([...picked], to);
      setPicked(new Set());
      await load();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const assign = async (all: boolean) => {
    setBusy(true);
    try {
      await api.assignSplits(ratios, all);
      setPicked(new Set());
      await load();
      message.success(all ? t("已重新划分") : t("已分配"));
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const resplit = () =>
    modal.confirm({
      title: t("按当前比例重新划分全部图片？"),
      content: t("已有的训练/验证/测试划分会被打乱重排。之前训练的结果将和新划分不可直接比较。"),
      okText: t("重新划分"),
      cancelText: t("取消"),
      onOk: () => assign(true),
    });

  const NAMES: Record<SplitKey, string> = { train: t("训练集"), val: t("验证集"), test: t("测试集"), unset: t("未划分") };
  const MOVE: Record<Exclude<SplitKey, "unset">, string> = { train: t("移到训练集"), val: t("移到验证集"), test: t("移到测试集") };
  const trainable = sum ? sum.train + sum.val + sum.test + sum.unset : 0;

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={980} title={t("训练集、验证集和测试集")} destroyOnHidden>
      <div className="dim" style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
        <div>{t("训练集：模型从这些图里学习。")}</div>
        <div>{t("验证集：不参与学习，每训练一轮用它评估一次，挑出效果最好的那一轮保存。")}</div>
        <div>{t("测试集：训练时完全不用，训完后在「评估」页单独打分，最接近模型上线后的真实效果。")}</div>
        <div>
          {review
            ? t("只有已标注和已审核的图参与训练；未标注、跳过的图不在这里。图分到哪个集合后不会自己变，前后几次训练可以直接比较。")
            : t("只有已标注的图参与训练；未标注、跳过的图不在这里。图分到哪个集合后不会自己变，前后几次训练可以直接比较。")}
        </div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <Segmented
          value={tab}
          onChange={(v) => switchTab(v as SplitKey)}
          options={(["train", "val", "test", "unset"] as SplitKey[])
            .filter((k) => k !== "unset" || (sum?.unset ?? 0) > 0 || tab === "unset")
            .map((k) => ({ value: k, label: `${NAMES[k]} ${sum ? sum[k] : ""}` }))}
        />
        <Space wrap>
          <span>{t("已选 {n} 张", { n: picked.size })}</span>
          <Button size="small" disabled={items.length === 0} onClick={() => setPicked(new Set([...picked, ...items.map((i) => i.id)]))}>
            {t("全选本页")}
          </Button>
          <Button size="small" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
            {t("清除选择")}
          </Button>
          {(["train", "val", "test"] as const)
            .filter((k) => k !== tab)
            .map((k) => (
              <Button key={k} size="small" type="primary" ghost loading={busy} disabled={picked.size === 0} onClick={() => move(k)}>
                {MOVE[k]}
              </Button>
            ))}
        </Space>
      </div>

      {sum && trainable > 1 && sum.train === 0 && (
        <div style={{ color: "var(--bad)", fontSize: 12, marginBottom: 8 }}>{t("训练集是空的，没法训练，请把一些图移到训练集。")}</div>
      )}
      {sum && trainable > 1 && sum.train > 0 && sum.val === 0 && sum.unset === 0 && (
        <div style={{ color: "var(--warn)", fontSize: 12, marginBottom: 8 }}>
          {t("没有验证集时用训练集评估，指标会偏高。建议分出 10%~20% 作为验证集。")}
        </div>
      )}

      <div style={{ maxHeight: "48vh", overflow: "auto" }}>
        {items.length === 0 ? (
          <Empty style={{ padding: 32 }} description={t("这里还没有图片")} />
        ) : (
          <div className="thumbs" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
            {items.map((it) => (
              <div
                key={it.id}
                className={picked.has(it.id) ? "thumb chosen" : "thumb"}
                onClick={() => toggle(it.id)}
                onDoubleClick={() => {
                  onClose();
                  annotateImage(it.id);
                }}
                title={`${it.name}  ${it.width}×${it.height}\n${t("单击选择，双击打开标注")}`}
              >
                <img src={thumbUrl(project.path, it.id)} loading="lazy" alt={it.name} draggable={false} />
                <Tag className="st" color={review && it.status === "reviewed" ? "success" : "processing"}>
                  {review && it.status === "reviewed" ? t("已审核") : t("已标注")}
                </Tag>
                <span className="nm">{it.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {total > PAGE && (
        <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
          <Pagination size="small" current={page} pageSize={PAGE} total={total} showSizeChanger={false} onChange={setPage} />
        </div>
      )}

      <div className="row" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}>
        <span>{t("训练 / 验证 / 测试 比例（%）")}</span>
        {[0, 1, 2].map((i) => (
          <InputNumber
            key={i}
            size="small"
            min={i === 0 ? 1 : 0}
            max={100}
            value={pct[i]}
            addonBefore={[t("训练"), t("验证"), t("测试")][i]}
            style={{ width: 130 }}
            onChange={(v) => {
              const next = [...pct];
              next[i] = Number(v ?? 0);
              onRatios(next.map((x) => x / 100) as [number, number, number]);
            }}
          />
        ))}
        {(sum?.unset ?? 0) > 0 && (
          <Button size="small" loading={busy} onClick={() => assign(false)}>
            {t("现在分配未划分的 {n} 张", { n: sum?.unset ?? 0 })}
          </Button>
        )}
        <Button size="small" loading={busy} disabled={trainable === 0} onClick={resplit}>
          {t("全部重新划分")}
        </Button>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        {t("新标注的图先放在「未划分」，开始训练时按这个比例自动分配。")}
      </div>
    </Modal>
  );
}
