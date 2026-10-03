import { categoriesInput, type CategorisationService } from "./application/categorisation";
import type { EnduteTransactionsService } from "./application/endute-transactions";
import type { EnduteService } from "./application/endute-service";
import { EnduteError } from "./integrations/endute";
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
  connectionDisplayMode,
  correctionInput,
  currentSnapshotInput,
  historicalSnapshotInput,
  identifier,
  period,
} from "./application/schemas";
const transactionPageInput = z
  .object({
    cursor: z.string().max(2000).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine(
    (input) =>
      (!input.from && !input.to) ||
      (!!input.from &&
        !!input.to &&
        input.from <= input.to &&
        Date.parse(input.to) - Date.parse(input.from) <= 366 * 86400000),
    "Choose a date range of up to one year.",
  );
const insightsInput = z
  .object({ cursor: z.string().max(2000).optional(), from: z.iso.date(), to: z.iso.date() })
  .refine(
    (input) =>
      input.from <= input.to && Date.parse(input.to) - Date.parse(input.from) <= 366 * 86400000,
    "Choose a date range of up to one year.",
  );
export interface ApiContext {
  readonly sessionHash?: string;
  readonly user: { userId: string; profile: Profile } | null;
  readonly trustedOrigin: boolean;
}
export interface ApiDependencies {
  readonly categorisation?: Pick<
    CategorisationService,
    "status" | "save" | "recategorise" | "manual" | "list" | "insights"
  >;
  readonly analysis?: Pick<EnduteTransactionsService, "status" | "list" | "sync" | "exclude">;
  readonly endute?: Pick<EnduteService, "connect" | "refresh" | "select" | "disconnect">;
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
    | "connect"
    | "disconnect"
    | "refreshValue"
    | "restartHistory"
    | "advanceHistory"
    | "setDisplayMode"
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
    if (error instanceof Trading212Error || error instanceof EnduteError)
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
  const categorisation = () => {
    if (!d.categorisation) throw new InputError("Categorisation is unavailable.");
    return d.categorisation;
  };
  const analysis = () => {
    if (!d.analysis) throw new InputError("Analysis is unavailable.");
    return d.analysis;
  };
  const endute = () => {
    if (!d.endute) throw new InputError("Endute tracking is unavailable.");
    return d.endute;
  };
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
    analysis: router({
      status: protectedProcedure.query(({ ctx }) => run(() => analysis().status(ctx.user.userId))),
      transactions: protectedProcedure
        .input(transactionPageInput.default({}))
        .query(({ ctx, input }) =>
          run(() =>
            d.categorisation
              ? d.categorisation.list(
                  ctx.user.userId,
                  input.cursor,
                  input.from && input.to ? { from: input.from, to: input.to } : undefined,
                )
              : analysis()
                  .list(
                    ctx.user.userId,
                    input.cursor,
                    input.from && input.to ? { from: input.from, to: input.to } : undefined,
                  )
                  .then((page) => ({
                    ...page,
                    rows: page.rows.map((row) => ({
                      ...row,
                      excluded: false,
                      customCategory: null,
                      classification: null,
                      categorisationStatus: "pending",
                    })),
                  })),
          ),
        ),
      insights: protectedProcedure
        .input(insightsInput)
        .query(({ ctx, input }) =>
          run(() =>
            categorisation().insights(
              ctx.user.userId,
              { from: input.from, to: input.to },
              input.cursor,
            ),
          ),
        ),
      refresh: protectedProcedure.mutation(({ ctx }) =>
        run(() => analysis().sync(ctx.user.userId)),
      ),
      exclude: protectedProcedure
        .input(z.object({ accountId: z.uuid(), transactionId: z.uuid(), excluded: z.boolean() }))
        .mutation(({ ctx, input }) => run(() => analysis().exclude(ctx.user.userId, input))),
    }),
    categories: router({
      status: protectedProcedure.query(({ ctx }) =>
        run(() => categorisation().status(ctx.user.userId)),
      ),
      save: protectedProcedure
        .input(categoriesInput)
        .mutation(({ ctx, input }) => run(() => categorisation().save(ctx.user.userId, input))),
      recategorise: protectedProcedure
        .input(z.object({ expectedVersion }))
        .mutation(({ ctx, input }) =>
          run(() => categorisation().recategorise(ctx.user.userId, input.expectedVersion)),
        ),
      assign: protectedProcedure
        .input(
          z.object({
            accountId: z.uuid(),
            transactionId: z.uuid(),
            categoryId: z.uuid().nullable(),
            expectedVersion,
          }),
        )
        .mutation(({ ctx, input }) => run(() => categorisation().manual(ctx.user.userId, input))),
    }),
    endute: router({
      connect: protectedProcedure
        .input(
          z.object({
            apiKey: z
              .string()
              .trim()
              .regex(/^edk_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/, "Enter a valid Endute API key."),
            expectedVersion,
          }),
        )
        .mutation(({ ctx, input }) => run(() => endute().connect(ctx.user.userId, input))),
      refresh: protectedProcedure
        .input(z.object({ id: identifier }))
        .mutation(({ ctx, input }) => run(() => endute().refresh(ctx.user.userId, input.id))),
      select: protectedProcedure
        .input(
          z.object({ id: identifier, externalIds: z.array(identifier).max(80), expectedVersion }),
        )
        .mutation(({ ctx, input }) =>
          run(() =>
            endute().select(ctx.user.userId, input.id, input.externalIds, input.expectedVersion),
          ),
        ),
      disconnect: protectedProcedure
        .input(z.object({ id: identifier, expectedVersion }))
        .mutation(({ ctx, input }) =>
          run(() => endute().disconnect(ctx.user.userId, input.id, input.expectedVersion)),
        ),
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
      setDisplayMode: protectedProcedure
        .input(z.object({ id: identifier, displayMode: connectionDisplayMode, expectedVersion }))
        .mutation(({ ctx, input }) =>
          run(() =>
            d.connections.setDisplayMode(
              ctx.user.userId,
              input.id,
              input.displayMode,
              input.expectedVersion,
            ),
          ),
        ),
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
