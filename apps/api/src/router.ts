import type { MonzoService } from "./application/monzo-service";
import { MonzoError } from "./integrations/monzo";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Profile } from "./storage/entities";
import type { WealthService } from "./application/wealth-service";
import type { ConnectionService } from "./application/connection-service";
import type { SnapshotService } from "./application/snapshot-service";
import { currentMonth, InputError } from "./application/snapshot-service";
import { ConflictError } from "./storage/errors";
import { Trading212Error } from "./integrations/trading212";
import {
  preferencesInput,
  expectedVersion,
  inlineCorrectionInput,
  accountInput,
  budgetInput,
  connectionInput,
  correctionInput,
  currentSnapshotInput,
  historicalSnapshotInput,
  identifier,
  period,
} from "./application/schemas";
export interface ApiContext {
  readonly sessionHash?: string;
  readonly user: { userId: string; profile: Profile } | null;
  readonly trustedOrigin: boolean;
}
export interface ApiDependencies {
  readonly monzo?: Pick<MonzoService, "start" | "refresh" | "select" | "disconnect">;
  readonly isDatabaseReady: () => Promise<boolean>;
  readonly wealth: Pick<
    WealthService,
    | "bootstrap"
    | "saveAccount"
    | "saveBudget"
    | "revisions"
    | "savePreferences"
    | "appearance"
    | "saveAppearance"
  >;
  readonly connections: Pick<
    ConnectionService,
    "connect" | "disconnect" | "refreshValue" | "restartHistory" | "advanceHistory"
  >;
  readonly snapshots: Pick<SnapshotService, "record" | "historical" | "correct" | "inlineCorrect">;
}
const t = initTRPC.context<ApiContext>().create({
  errorFormatter({ shape }) {
    return { ...shape, data: { ...shape.data, stack: undefined } };
  },
});
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next, type }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  if (type === "mutation" && !ctx.trustedOrigin)
    throw new TRPCError({ code: "FORBIDDEN", message: "Request origin is not allowed." });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
export const router = t.router;
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConflictError)
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    if (error instanceof InputError)
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    if (error instanceof MonzoError)
      throw new TRPCError({
        code: error.kind === "rate-limit" ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
        message: error.message,
      });
    if (error instanceof Trading212Error)
      throw new TRPCError({
        code: error.retryAfterSeconds ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
        message: error.message,
      });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The operation could not be completed. Retry or reload the record.",
    });
  }
}
export function createRouter(d: ApiDependencies) {
  const monzo = () => {
    if (!d.monzo) throw new InputError("Monzo tracking is unavailable.");
    return d.monzo;
  };
  return router({
    health: publicProcedure.query(async () => ({
      api: "ready" as const,
      database: (await d.isDatabaseReady()) ? ("ready" as const) : ("unavailable" as const),
    })),
    session: publicProcedure.query(({ ctx }) =>
      ctx.user ? { name: ctx.user.profile.name, email: ctx.user.profile.email } : null,
    ),
    bootstrap: protectedProcedure.query(({ ctx }) =>
      run(async () => ({
        ...(await d.wealth.bootstrap(ctx.user.userId)),
        currentMonth: currentMonth(new Date()),
      })),
    ),
    appearance: router({
      get: protectedProcedure.query(({ ctx }) => run(() => d.wealth.appearance(ctx.user.userId))),
      save: protectedProcedure
        .input(z.object({ mode: z.enum(["dark", "light"]), expectedVersion }))
        .mutation(({ ctx, input }) =>
          run(() => d.wealth.saveAppearance(ctx.user.userId, input.mode, input.expectedVersion)),
        ),
    }),
    preferences: router({
      save: protectedProcedure
        .input(preferencesInput)
        .mutation(({ ctx, input }) =>
          run(() =>
            d.wealth.savePreferences(
              ctx.user.userId,
              input.id,
              input.preferences,
              input.expectedVersion,
            ),
          ),
        ),
    }),
    accounts: router({
      save: protectedProcedure
        .input(accountInput)
        .mutation(({ ctx, input }) => run(() => d.wealth.saveAccount(ctx.user.userId, input))),
    }),
    budget: router({
      save: protectedProcedure
        .input(budgetInput)
        .mutation(({ ctx, input }) =>
          run(() => d.wealth.saveBudget(ctx.user.userId, input.plan, input.expectedVersion)),
        ),
    }),
    snapshots: router({
      inlineCorrect: protectedProcedure
        .input(inlineCorrectionInput)
        .mutation(({ ctx, input }) => run(() => d.snapshots.inlineCorrect(ctx.user.userId, input))),

      record: protectedProcedure
        .input(currentSnapshotInput)
        .mutation(({ ctx, input }) => run(() => d.snapshots.record(ctx.user.userId, input))),
      historical: protectedProcedure
        .input(historicalSnapshotInput)
        .mutation(({ ctx, input }) => run(() => d.snapshots.historical(ctx.user.userId, input))),
      correct: protectedProcedure
        .input(correctionInput)
        .mutation(({ ctx, input }) => run(() => d.snapshots.correct(ctx.user.userId, input))),
      revisions: protectedProcedure
        .input(z.object({ month: period }))
        .query(({ ctx, input }) => run(() => d.wealth.revisions(ctx.user.userId, input.month))),
    }),
    monzo: router({
      start: protectedProcedure
        .input(
          z.object({
            clientId: z.string().trim().min(1).max(512),
            clientSecret: z.string().trim().min(1).max(512),
            connectionId: identifier.optional(),
          }),
        )
        .mutation(({ ctx, input }) =>
          run(() => monzo().start(ctx.user.userId, ctx.sessionHash ?? "", input)),
        ),
      refresh: protectedProcedure
        .input(z.object({ id: identifier }))
        .mutation(({ ctx, input }) => run(() => monzo().refresh(ctx.user.userId, input.id))),
      select: protectedProcedure
        .input(
          z.object({ id: identifier, externalIds: z.array(identifier).max(80), expectedVersion }),
        )
        .mutation(({ ctx, input }) =>
          run(() =>
            monzo().select(ctx.user.userId, input.id, input.externalIds, input.expectedVersion),
          ),
        ),
      disconnect: protectedProcedure
        .input(z.object({ id: identifier, expectedVersion }))
        .mutation(({ ctx, input }) =>
          run(() => monzo().disconnect(ctx.user.userId, input.id, input.expectedVersion)),
        ),
    }),
    connections: router({
      connect: protectedProcedure
        .input(connectionInput)
        .mutation(({ ctx, input }) => run(() => d.connections.connect(ctx.user.userId, input))),
      disconnect: protectedProcedure
        .input(z.object({ id: identifier, version: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          run(() => d.connections.disconnect(ctx.user.userId, input.id, input.version)),
        ),
      refresh: protectedProcedure
        .input(z.object({ id: identifier }))
        .mutation(({ ctx, input }) =>
          run(() => d.connections.refreshValue(ctx.user.userId, input.id)),
        ),
      historyStart: protectedProcedure
        .input(z.object({ id: identifier }))
        .mutation(({ ctx, input }) =>
          run(() => d.connections.restartHistory(ctx.user.userId, input.id)),
        ),
      historyStep: protectedProcedure
        .input(z.object({ id: identifier }))
        .mutation(({ ctx, input }) =>
          run(() => d.connections.advanceHistory(ctx.user.userId, input.id)),
        ),
    }),
  });
}
