import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HttpError,
  badRequest,
  forbidden,
  isHttpError,
  notFound,
  tooManyRequests,
  unauthorized,
  validationFailed,
} from "./errors";

test("isHttpError recognises HttpError only", () => {
  assert.equal(isHttpError(new HttpError(400, "bad_request", "nope")), true);
  assert.equal(isHttpError(new Error("nope")), false);
  assert.equal(isHttpError(null), false);
  assert.equal(isHttpError({ statusCode: 400 }), false);
});

test("badRequest carries status, code and field errors", () => {
  const error = badRequest("Invalid.", { email: ["Required."] });
  assert.equal(error.statusCode, 400);
  assert.equal(error.code, "bad_request");
  assert.deepEqual(error.fields, { email: ["Required."] });
});

test("factory defaults", () => {
  assert.equal(unauthorized().statusCode, 401);
  assert.equal(forbidden().statusCode, 403);
  assert.equal(notFound().statusCode, 404);
  assert.equal(notFound().code, "not_found");
  assert.equal(tooManyRequests().statusCode, 429);
  assert.equal(tooManyRequests().code, "rate_limited");
  assert.equal(validationFailed("Invalid.").statusCode, 422);
});

test("HttpError is a real Error subclass", () => {
  const error = new HttpError(418, "teapot", "I am a teapot");
  assert.ok(error instanceof Error);
  assert.equal(error.message, "I am a teapot");
  assert.equal(error.name, "HttpError");
});
