import { PvpSettlementOptions } from "../options";
import { WagerReconcilerService } from "./wager-reconciler.service";

jest.mock("../wager/wager.service", () => ({ WagerService: class {} }));

describe("WagerReconcilerService metrics", () => {
  const observations = jest.fn();
  const exhausted = jest.fn();
  const options: PvpSettlementOptions = {
    mode: "mock",
    authenticate: () => null,
    observability: {
      onReconcileSweep: observations,
      onReconcileExhausted: exhausted,
    },
  const options: PvpSettlementOptions = {
    mode: "mock",
    authenticate: () => null,
    observability: { onReconcileSweep: observations },
  };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [true, "success"],
    [false, "skipped"],
  ] as const)("records %s lock acquisition as %s", async (locked, outcome) => {
    const runner = {
      connect: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ locked }])
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
      isReleased: false,
    };
    const dataSource = { createQueryRunner: jest.fn(() => runner) };
    const wagers = { findNeedingAttention: jest.fn().mockResolvedValue([]) };
    const reconciler = new WagerReconcilerService(
      wagers as never,
      dataSource as never,
      options,
    );

    await reconciler.sweep();

    expect(observations).toHaveBeenCalledWith({
      outcome,
      durationSeconds: expect.any(Number),
    });
  });

  it("records a failed sweep without throwing from the background worker", async () => {
    const runner = {
      connect: jest.fn().mockRejectedValue(new Error("database unavailable")),
      query: jest.fn(),
      release: jest.fn(),
      isReleased: false,
    };
    const reconciler = new WagerReconcilerService(
      {} as never,
      { createQueryRunner: () => runner } as never,
      options,
    );

    await expect(reconciler.sweep()).resolves.toBeUndefined();
    expect(observations).toHaveBeenCalledWith({
      outcome: "failed",
      durationSeconds: expect.any(Number),
    });
  });

  it("reports a wager that exhausted its reconciliation attempts exactly once", async () => {
    const runner = {
      connect: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
      isReleased: false,
    };
    const wagers = {
      findNeedingAttention: jest
        .fn()
        .mockResolvedValue([{ id: "wager-1", status: "settling" }]),
      reconcile: jest.fn().mockResolvedValue({
        id: "wager-1",
        status: "failed",
        failureReason: "Settlement did not land after 8 attempts",
      }),
    };
    const reconciler = new WagerReconcilerService(
      wagers as never,
      { createQueryRunner: () => runner } as never,
      options,
    );

    await reconciler.sweep();

    expect(exhausted).toHaveBeenCalledTimes(1);
    expect(exhausted).toHaveBeenCalledWith({
      wagerId: "wager-1",
      attempts: 8,
      failureReason: "Settlement did not land after 8 attempts",
    });
  });
});
