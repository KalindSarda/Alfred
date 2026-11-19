import { Hono } from "hono";
import type { AppEnv } from "../app";
import { MoveHoldings } from "../schemas/investmentAccount";
import { moveHoldings } from "../services/investmentAccounts";
import { AddContribution, AddLot, AddPartnerStake, EditPartnerEntry, BuyHolding, EditEntry, EditLot, ConvertHolding, CreateHolding, ListHoldingsQuery, SellHolding, SetHoldingRate, SetHoldingValue, SetEntryUnits, UpdateHolding } from "../schemas/holding";
import { addPartnerStake, editPartnerEntry, removePartnerEntry } from "../services/holdingPartners";
import { addContribution, addLot, buy, editContribution, editEntry, editLot, removeEntry, removeValue, closeHolding, convertToUnits, createHolding, deleteHolding, listHoldings, removeContribution, removeLot, reopenHolding, sell, setEntryUnits, setRate, setValue, updateHolding } from "../services/holdings";
import { ValidationError } from "../config/errors";
import { isValidIstDate } from "../domain/dates";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const holdingRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { status } = parseQuery(c, ListHoldingsQuery);
    return c.json(await listHoldings(c.var.auth.db, c.var.userId, requestToday(c.var.auth), status));
  })
  .post("/", async (c) => c.json(await createHolding(c.var.auth.db, c.var.userId, await parseJson(c, CreateHolding), requestToday(c.var.auth)), 201))
  .post("/move", async (c) => c.json(await moveHoldings(c.var.auth.db, c.var.userId, await parseJson(c, MoveHoldings))))
  .patch("/:id", async (c) => c.json(await updateHolding(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateHolding), requestToday(c.var.auth))))
  .post("/:id/value", async (c) => c.json(await setValue(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, SetHoldingValue), requestToday(c.var.auth))))
  .post("/:id/rate", async (c) => c.json(await setRate(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, SetHoldingRate), requestToday(c.var.auth))))
  .post("/:id/lots", async (c) => c.json(await addLot(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, AddLot), requestToday(c.var.auth)), 201))
  .patch("/:id/entries/:txnId", async (c) => c.json(await editEntry(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("txnId"), await parseJson(c, EditEntry), requestToday(c.var.auth))))
  .delete("/:id/entries/:txnId", async (c) => c.json(await removeEntry(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("txnId"), requestToday(c.var.auth))))
  .patch("/:id/lots/:lotId", async (c) => c.json(await editLot(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("lotId"), await parseJson(c, EditLot), requestToday(c.var.auth))))
  .patch("/:id/contributions/:contributionId", async (c) => c.json(await editContribution(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("contributionId"), await parseJson(c, AddContribution), requestToday(c.var.auth))))
  .delete("/:id/values/:date", async (c) => {
    const date = c.req.param("date");
    if (!isValidIstDate(date)) throw new ValidationError("Request validation failed", [{ path: "date", message: "Not a real calendar date" }]);
    return c.json(await removeValue(c.var.auth.db, c.var.userId, c.req.param("id"), date, requestToday(c.var.auth)));
  })
  .post("/:id/partners", async (c) => c.json(await addPartnerStake(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, AddPartnerStake), requestToday(c.var.auth)), 201))
  .patch("/:id/partners/:entryId", async (c) => c.json(await editPartnerEntry(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("entryId"), await parseJson(c, EditPartnerEntry), requestToday(c.var.auth))))
  .delete("/:id/partners/:entryId", async (c) => c.json(await removePartnerEntry(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("entryId"), requestToday(c.var.auth))))
  .post("/:id/contributions", async (c) => c.json(await addContribution(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, AddContribution), requestToday(c.var.auth)), 201))
  .delete("/:id/contributions/:contributionId", async (c) => c.json(await removeContribution(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("contributionId"), requestToday(c.var.auth))))
  .delete("/:id/lots/:lotId", async (c) => c.json(await removeLot(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("lotId"), requestToday(c.var.auth))))
  .post("/:id/convert", async (c) => c.json(await convertToUnits(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, ConvertHolding), requestToday(c.var.auth))))
  .post("/:id/entries/:txnId/units", async (c) => c.json(await setEntryUnits(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("txnId"), (await parseJson(c, SetEntryUnits)).unitsE4, requestToday(c.var.auth))))
  .post("/:id/buy", async (c) => c.json(await buy(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, BuyHolding), requestToday(c.var.auth)), 201))
  .post("/:id/sell", async (c) => c.json(await sell(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, SellHolding), requestToday(c.var.auth)), 201))
  .post("/:id/close", async (c) => c.json(await closeHolding(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .post("/:id/reopen", async (c) => c.json(await reopenHolding(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .delete("/:id", async (c) => {
    await deleteHolding(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
