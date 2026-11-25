// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JourneyForm } from "@/components/JourneyForm";
import { PlaceField } from "@/components/PlaceField";
import { addRecent, parseRecent, saveRecent } from "@/lib/journey/recent";
import { HeatWarnings } from "@/components/Badges";
import { AnswerCard, percentParts, seatVerdict, SunShare } from "@/components/AnswerCard";
import { ExposureBar, explanation } from "@/components/RouteCard";
import type { EvaluatedRoute, VehicleSideExposure } from "@/lib/domain/types";
import { defaultDeparture, fromQuery, toQuery } from "@/lib/journey/query";
import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";

const ja = getMessages("ja");
const en = getMessages("en");

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("JourneyForm", () => {
  it("出発地・目的地が未選択なら送信せず、エラーを表示する", () => {
    render(<JourneyForm showMap={false} />);
    fireEvent.click(screen.getByRole("button", { name: "日陰の席を探す" }));
    expect(screen.getByText("出発地を候補から選んでください。")).toBeInTheDocument();
    expect(screen.getByText("目的地を候補から選んでください。")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("候補を検索して選び、条件をURLに入れて結果ページへ移動する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const label = new URL(url, "http://x").searchParams.get("q")!;
        return new Response(JSON.stringify({ results: [{ lat: 35.68, lon: label === "A" ? 139.7 : 139.71, label: `${label}駅` }] }));
      }),
    );
    render(<JourneyForm showMap={false} transitAvailable initial={{ departure: "2026-07-01T09:00" }} />);
    const [originInput, destInput] = screen.getAllByRole("searchbox");
    fireEvent.change(originInput!, { target: { value: "A" } });
    fireEvent.keyDown(originInput!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "A駅" }));
    fireEvent.change(destInput!, { target: { value: "B" } });
    fireEvent.keyDown(destInput!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "B駅" }));
    fireEvent.click(screen.getByLabelText("電車"));
    fireEvent.click(screen.getByLabelText("日差しを避けたい"));
    fireEvent.click(screen.getByRole("button", { name: "日陰の席を探す" }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const url = push.mock.calls[0]![0] as string;
    const state = fromQuery(new URLSearchParams(url.split("?")[1]));
    expect(state).toMatchObject({ mode: "train", departure: "2026-07-01T09:00", preferences: ["minimise_sun"] });
    expect(state!.origin.label).toBe("A駅");
  });

  it("移動手段は道路（車・バス）と電車のみ。徒歩・自転車は無く、時刻表がなければ電車は準備中として選べない", () => {
    render(<JourneyForm showMap={false} initial={{ mode: "bus" }} />);
    expect(screen.queryByLabelText(/徒歩/)).toBeNull();
    expect(screen.queryByLabelText(/自転車/)).toBeNull();
    expect(screen.getByLabelText(/車・バス/)).toBeChecked();
    expect(screen.getByLabelText(/電車/)).toBeDisabled();
    expect(screen.getAllByRole("radio", { name: /車・バス|電車/ })).toHaveLength(2);
    // 道路では順位に反映できる希望条件がないため表示しない
    expect(screen.queryByText("重視すること（任意・複数選択可）")).toBeNull();
  });

  it("地名検索が失敗したら案内を表示する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    render(<JourneyForm showMap={false} />);
    const [originInput] = screen.getAllByRole("searchbox");
    fireEvent.change(originInput!, { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "「X」で駅・施設も検索" }));
    expect(await screen.findByText(/地名検索サービスに接続できませんでした/)).toBeInTheDocument();
  });

  it("検索ボタンを押さなくても、入力に合わせて候補（国土地理院のみ）を表示する", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ results: [{ lat: 35.68, lon: 139.76, label: "東京都千代田区丸の内" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    render(<PlaceField label="出発地" placeholder="" value={null} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "検索" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "丸の内" } });
    // 入力直後は「駅・施設も検索」だけ。止まってから候補を取りに行く
    expect(screen.getByRole("button", { name: "「丸の内」で駅・施設も検索" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "東京都千代田区丸の内" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain("mode=suggest");
    expect(onChange).toHaveBeenCalledWith({ lat: 35.68, lon: 139.76, label: "東京都千代田区丸の内" });
  });

  it("選択済みの欄は「変更」ボタンなしで、タップすると地名入りの入力欄に戻り、Esc で元に戻る", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ lat: 35.0, lon: 135.7, label: "京都駅" }] }))));
    const onChange = vi.fn();
    render(<PlaceField label="目的地" placeholder="" value={{ lat: 35.68, lon: 139.76, label: "東京駅" }} onChange={onChange} />);
    expect(screen.queryByText("変更")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /東京駅/ }));
    const input = screen.getByRole("searchbox");
    expect(input).toHaveValue("東京駅");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /東京駅/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    fireEvent.click(await screen.findByRole("button", { name: "京都駅" }));
    expect(onChange).toHaveBeenCalledWith({ lat: 35.0, lon: 135.7, label: "京都駅" });
  });

  it("候補の取得に失敗しても、入力中はエラーを出さない", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PlaceField label="出発地" placeholder="" value={null} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "丸の内" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/地名検索サービスに接続できませんでした/)).toBeNull();
  });
});

describe("最近の検索", () => {
  const a = { lat: 35.68, lon: 139.76, label: "A駅" };
  const b = { lat: 35.69, lon: 139.7, label: "B駅" };

  it("同じ組は先頭にまとめ、壊れたデータは無視する", () => {
    const one = addRecent([], { origin: a, destination: b, mode: "train", at: 1 });
    const two = addRecent(one, { origin: b, destination: a, mode: "car", at: 2 });
    const again = addRecent(two, { origin: a, destination: b, mode: "car", at: 3 });
    expect(again.map((t) => t.at)).toEqual([3, 2]);
    expect(parseRecent("not json")).toEqual([]);
    saveRecent({ lat: 35.123456, lon: 139.654321, label: "現在地" }, b, "car", true);
    const raw = window.localStorage.getItem("hikage-navi:recent-trips")!;
    expect(raw).not.toContain("35.123456");
    expect(parseRecent(raw)[0]).toMatchObject({ origin: null, destination: b });
    expect(parseRecent(JSON.stringify([{ origin: null, destination: { lat: "x" }, mode: "car" }]))).toEqual([]);
    // 以前の徒歩・自転車の履歴は表示しない
    expect(parseRecent(JSON.stringify([{ origin: null, destination: b, mode: "walk", at: 1 }]))).toEqual([]);
  });

  it("検索すると例の代わりに最近の検索を表示し、押すと入力される。現在地の座標は保存しない", async () => {
    window.localStorage.setItem(
      "hikage-navi:recent-trips",
      JSON.stringify([
        { origin: a, destination: b, mode: "car", at: 2 },
        { origin: null, destination: a, mode: "car", at: 1 },
      ]),
    );
    render(<JourneyForm showMap={false} />);
    expect(await screen.findByText("最近の検索")).toBeInTheDocument();
    expect(screen.queryByText(/東京駅 → 横浜駅/)).toBeNull();
    expect(screen.getByRole("button", { name: "現在地 → A駅" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A駅 → B駅" }));
    expect(screen.getByLabelText(/車・バス/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "日陰の席を探す" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const saved = parseRecent(window.localStorage.getItem("hikage-navi:recent-trips")!);
    expect(saved[0]).toMatchObject({ origin: a, destination: b, mode: "car" });

    fireEvent.click(screen.getByRole("button", { name: "履歴を消す" }));
    expect(await screen.findByText("例から試す")).toBeInTheDocument();
    expect(window.localStorage.getItem("hikage-navi:recent-trips")).toBeNull();
  });
});

describe("表示コンポーネント", () => {
  it("暑さの警告は色だけでなく文字の区分を示し、深刻なら alert", () => {
    render(<HeatWarnings warnings={[{ level: "danger", code: "wbgt_danger", value: 31.5 }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("【危険】");
    expect(screen.getByRole("alert")).toHaveTextContent("31.5");
  });

  it("日陰の内訳を数値で表示する", () => {
    const r = {
      exposure: { outdoorMin: 20, sunUpOutdoorMin: 20, potentialSunMin: 5, shadedMin: 8, unknownShadeMin: 7 },
    } as unknown as EvaluatedRoute;
    render(<ExposureBar r={r} />);
    expect(screen.getByText("日陰と推定").nextSibling).toHaveTextContent("約8分");
    expect(screen.getByText("判定できず").nextSibling).toHaveTextContent("約7分");
  });

  it("おすすめの説明は、意味のある差がある理由だけを並べる", () => {
    expect(explanation({ routeId: "a", rank: 1, score: 100, metricsUsed: [], metricsMissing: [], reasons: [{ code: "less_outdoor", diff: 4, unit: "min" }, { code: "less_sun", diff: 6, unit: "min" }] }, 2, ja)).toBe(
      "このルートは、屋外にいる時間が約4分短い、日差しを受ける可能性のある時間が約6分短いため、おすすめです。",
    );
    expect(explanation({ routeId: "b", rank: 2, score: 0, metricsUsed: [], metricsMissing: [], reasons: [] }, 2, ja)).toBeNull();
  });

  it("英語表示では、警告・内訳・おすすめの説明が英語になる", () => {
    render(
      <I18nProvider locale="en">
        <HeatWarnings warnings={[{ level: "danger", code: "wbgt_danger", value: 31.5 }]} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("【Danger】");
    expect(screen.getByRole("alert")).toHaveTextContent("Heat index (WBGT) forecast 31.5");
    expect(explanation({ routeId: "a", rank: 1, score: 100, metricsUsed: [], metricsMissing: [], reasons: [{ code: "less_outdoor", diff: 4, unit: "min" }] }, 2, en)).toBe(
      "Recommended because it is about 4 min less time outdoors.",
    );
  });

  it("英語の文言は日本語と同じ項目を持つ", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) && k !== "notices" && k !== "validation" && k !== "attributions" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(en).sort()).toEqual(keys(ja).sort());
    expect(Object.keys(en.notices).sort()).toEqual(Object.keys(ja.notices).sort());
    expect(Object.keys(en.validation).sort()).toEqual(Object.keys(ja.validation).sort());
  });

  it("「今すぐ出発」は15分単位に丸めず、現在の日本時間の分をそのまま使う", () => {
    // 2026-11-12 02:47:30Z = 日本時間 11:47
    expect(defaultDeparture(new Date("2026-11-12T02:47:30Z"))).toBe("2026-11-12T11:47");
    expect(defaultDeparture(new Date("2026-11-12T14:59:59Z"))).toBe("2026-11-12T23:59");
  });

  it("検索条件はURLで往復できる", () => {
    const s = { origin: { lat: 35.1, lon: 139.2, label: "あ" }, destination: { lat: 35.2, lon: 139.3 }, departure: "2026-07-01T09:00", mode: "train" as const, preferences: [] };
    expect(fromQuery(new URLSearchParams(toQuery(s)))).toEqual({ ...s, destination: { ...s.destination, label: undefined } });
    expect(fromQuery(new URLSearchParams("olat=abc"))).toBeNull();
    // 徒歩・自転車は検索できない
    expect(fromQuery(new URLSearchParams(toQuery(s).replace("m=train", "m=walk")))).toBeNull();
  });

  it("共有リンクの長すぎる地名は、サーバーの上限（200文字）で切る", () => {
    const s = { origin: { lat: 35.1, lon: 139.2, label: "あ".repeat(250) }, destination: { lat: 35.2, lon: 139.3, label: "😀".repeat(150) }, departure: "2026-07-01T09:00", mode: "train" as const, preferences: [] };
    const r = fromQuery(new URLSearchParams(toQuery(s)))!;
    expect(r.origin.label).toBe("あ".repeat(200));
    // 絵文字（2単位）の途中では切らない
    expect(r.destination.label).toBe("😀".repeat(100));
    expect(fromQuery(new URLSearchParams(toQuery({ ...s, origin: { ...s.origin, label: "   " } })))!.origin.label).toBeUndefined();
  });
});

describe("ひと目でわかる結論", () => {
  const side = (o: Partial<VehicleSideExposure>): VehicleSideExposure => ({
    legIndex: 0, leftMin: 0, rightMin: 0, frontOrBackMin: 0, lowSunMin: 0, nightMin: 0, totalMin: 30, shadierSide: "unknown", caveats: [], ...o,
  });

  it("座席の結論: 区間の判定が揃えばその側、食い違えば「区間による」、太陽がなければ「太陽なし」", () => {
    expect(seatVerdict([side({ shadierSide: "left", leftMin: 2, rightMin: 20 })])).toEqual({ kind: "left", leftMin: 2, rightMin: 20 });
    expect(seatVerdict([side({ shadierSide: "left", leftMin: 1, rightMin: 9 }), side({ legIndex: 1, shadierSide: "right", leftMin: 9, rightMin: 1 })]).kind).toBe("mixed");
    // 区間で食い違っても、全体で片側が明らかに少なければその側を勧める（例: 左に111分・右に5分 → 右）
    expect(
      seatVerdict([side({ shadierSide: "right", leftMin: 108, rightMin: 2 }), side({ legIndex: 1, shadierSide: "left", leftMin: 3, rightMin: 3.5 })]),
    ).toEqual({ kind: "right", leftMin: 111, rightMin: 5.5, changes: true });
    expect(seatVerdict([side({ shadierSide: "similar", leftMin: 0, rightMin: 0 })]).kind).toBe("no_sun");
    expect(seatVerdict([side({ shadierSide: "unknown" })]).kind).toBe("unknown");
    expect(seatVerdict([side({ shadierSide: "similar", leftMin: 5, rightMin: 6 })]).kind).toBe("similar");
  });

  it("座席の結論は、表示する左右の分数と食い違わない", () => {
    // 大阪駅→関西空港 14:00 の実例: 左13分・右25分なのに「差は小さい」とは言わない
    expect(seatVerdict([side({ shadierSide: "similar", leftMin: 13, rightMin: 25 })]).kind).toBe("left");
    // 区間ごとには「差は小さい」でも、合計ではっきり差があればその側
    expect(seatVerdict([side({ shadierSide: "similar", leftMin: 4, rightMin: 8 }), side({ legIndex: 1, shadierSide: "similar", leftMin: 4, rightMin: 8 })]).kind).toBe("left");
    // 日差しの多い側はすすめない
    expect(seatVerdict([side({ shadierSide: "left", leftMin: 12, rightMin: 10 }), side({ legIndex: 1, shadierSide: "similar", leftMin: 3, rightMin: 3 })]).kind).toBe("similar");
  });

  it("「差は小さめ」: 横から差し込む日差しの量ではほぼ同じなら、すすめる側に添える", () => {
    // エンジンが「差は小さめ」とした区間（大阪駅→関西空港 14:00 の実例）
    expect(seatVerdict([side({ shadierSide: "left", slightDifference: true, leftMin: 13, rightMin: 25 })])).toEqual({ kind: "left", leftMin: 13, rightMin: 25, slight: true });
    // どの区間も重み付けでは差がなく、合計の分数で決まった場合
    expect(seatVerdict([side({ shadierSide: "similar", leftMin: 4, rightMin: 8 }), side({ legIndex: 1, shadierSide: "similar", leftMin: 4, rightMin: 8 })])).toMatchObject({ kind: "left", slight: true });
    // はっきり差がある区間が1つでもあれば「差は小さめ」としない
    expect(
      seatVerdict([side({ shadierSide: "left", slightDifference: true, leftMin: 13, rightMin: 25 }), side({ legIndex: 1, shadierSide: "left", leftMin: 0, rightMin: 30 })]),
    ).toEqual({ kind: "left", leftMin: 13, rightMin: 55 });
  });

  it("結論カード: 差が小さめなら「ややおすすめ」と示す", () => {
    const r = {
      route: { startTime: "2026-11-25T14:00:00+09:00", endTime: "2026-11-25T14:55:00+09:00", durationSec: 3300 },
      exposure: { outdoorMin: 0, sunUpOutdoorMin: 0, potentialSunMin: 0, shadedMin: 0, unknownShadeMin: 0 },
      vehicleSides: [side({ shadierSide: "left", slightDifference: true, leftMin: 13, rightMin: 25, frontOrBackMin: 13, totalMin: 51 })],
      heatWarnings: [],
    } as unknown as EvaluatedRoute;
    render(<AnswerCard r={r} label="おすすめのルート" />);
    expect(screen.getByText("左側の席がややおすすめ（差は小さめ）")).toBeInTheDocument();
    expect(screen.getByText(/日差しがやや少ない側です（左右の差は小さめ）/)).toBeInTheDocument();
    expect(screen.getByText("反対の右側は 約25分 日が当たります")).toBeInTheDocument();
  });

  it("日差しの割合: 左・右・前後真上・日没後の4つで合計100%（名古屋→京都の例）、地下鉄区間は含めない", () => {
    expect(percentParts([38, 20, 19, 37])).toEqual([33, 18, 17, 32]);
    expect(percentParts([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentParts([0, 0])).toEqual([0, 0]);
    render(
      <SunShare
        sides={[
          side({ shadierSide: "right", leftMin: 38, rightMin: 20, frontOrBackMin: 19, nightMin: 37 }),
          side({ legIndex: 1, shadierSide: "unknown", leftMin: 50 }),
        ]}
      />,
    );
    expect(screen.getByText("左側に日差し").nextSibling).toHaveTextContent("33%約38分");
    expect(screen.getByText("右側に日差し").nextSibling).toHaveTextContent("18%");
    expect(screen.getByText("前・後ろ・真上から").nextSibling).toHaveTextContent("17%");
    expect(screen.getByText("日差しなし（日没後）").nextSibling).toHaveTextContent("32%");
  });

  it("結論カードは座席の側と、反対側の日差しの時間を文字で示す", () => {
    const r = {
      route: { startTime: "2026-07-01T09:00:00+09:00", endTime: "2026-07-01T09:36:00+09:00", durationSec: 2160 },
      exposure: { outdoorMin: 0, sunUpOutdoorMin: 0, potentialSunMin: 0, shadedMin: 0, unknownShadeMin: 0 },
      vehicleSides: [side({ shadierSide: "right", leftMin: 30, rightMin: 1 })],
      heatWarnings: [],
    } as unknown as EvaluatedRoute;
    render(<AnswerCard r={r} label="おすすめのルート" />);
    expect(screen.getByText("右側の席がおすすめ")).toBeInTheDocument();
    expect(screen.getByText(/🌿 日差しが少ない側です$/)).toBeInTheDocument();
    expect(screen.getByText("反対の左側は 約30分 日が当たります")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /座席の図/ })).toBeInTheDocument();
  });

  it("「編集」で戻っても、今すぐで検索していたなら「今すぐ」のまま。別の日時を選んでいたらその日時を保つ", () => {
    render(<JourneyForm showMap={false} initial={{ departure: defaultDeparture() }} />);
    expect(screen.getByLabelText(/今すぐ出発/)).toBeChecked();
    cleanup();
    render(<JourneyForm showMap={false} initial={{ departure: "2026-07-01T09:00" }} />);
    expect(screen.getByLabelText(/日時を指定/)).toBeChecked();
    expect(screen.getByLabelText("出発日")).toHaveValue("2026-07-01");
  });

  it("出発時刻は既定で「今すぐ」。日時を指定すると入力欄が出る", () => {
    render(<JourneyForm showMap={false} />);
    expect(screen.getByLabelText(/今すぐ出発/)).toBeChecked();
    expect(screen.queryByLabelText("出発日")).toBeNull();
    fireEvent.click(screen.getByLabelText(/日時を指定/));
    expect(screen.getByLabelText("出発日")).toBeInTheDocument();
  });
});

describe("日陰が判定できないときの結論", () => {
  it("日差し0分でも、判定できない時間しかなければ「日差しが少ない」とは言わない", () => {
    const r = {
      route: { startTime: "2026-07-01T13:00:00+09:00", endTime: "2026-07-01T13:20:00+09:00", durationSec: 1200 },
      exposure: { outdoorMin: 20, sunUpOutdoorMin: 20, potentialSunMin: 0, shadedMin: 0, unknownShadeMin: 20 },
      vehicleSides: [],
      heatWarnings: [],
    } as unknown as EvaluatedRoute;
    render(<AnswerCard r={r} label="おすすめのルート" />);
    expect(screen.getByText("日陰を判定できませんでした")).toBeInTheDocument();
    expect(screen.queryByText("日差しを受ける可能性はほとんどありません")).toBeNull();
    expect(screen.getByText("判定できず 約20分")).toBeInTheDocument();
  });

});

describe("候補の「早」「楽」の印", () => {
  const R = (id: string, min: number, transfers?: number) => ({ route: { id, durationSec: min * 60, transfers } });
  it("最短の経路に「早」、乗り換え最少に「楽」を付ける", async () => {
    const { routeTags } = await import("@/components/SearchResults");
    const t = routeTags([R("a", 50, 2), R("b", 62, 0), R("c", 55, 1)]);
    expect(t.get("a")).toEqual(["fast"]);
    expect(t.get("b")).toEqual(["easy"]);
    expect(t.get("c")).toBeUndefined();
  });
  it("候補が1件だけ・全候補が同じなら付けない", async () => {
    const { routeTags } = await import("@/components/SearchResults");
    expect(routeTags([R("a", 50, 1)]).size).toBe(0);
    expect(routeTags([R("a", 50, 1), R("b", 50, 1)]).size).toBe(0);
    // 乗り換え回数が分からない（車）ときは「楽」を付けない
    expect(routeTags([R("a", 50), R("b", 60)]).get("a")).toEqual(["fast"]);
  });
});
