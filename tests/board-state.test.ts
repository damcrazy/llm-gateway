import { expect, test } from "bun:test"

import {
  initialBoard,
  stateToBoard,
  toInput,
  type Board,
} from "@/app/(dashboard)/apps/[id]/board-state"
import type { BucketsState } from "@/lib/bucket-assistant/ops"

import { bucketModel, bucketsData } from "./bucket-fixtures"

const data = bucketsData([bucketModel({ id: "a" }), bucketModel({ id: "b" })], {
  buckets: [
    {
      name: "smart",
      modelIds: ["a", "b"],
      strategy: "fastest",
      hedgeAfterMs: 2000,
    },
    { name: "fast", modelIds: ["b"], strategy: "ordered", hedgeAfterMs: null },
  ],
  defaultBucket: "fast",
  onlyBucketModels: true,
})

const itemKeys = (board: Board) =>
  Object.values(board.columns).flatMap((items) => items.map((item) => item.key))

test("toInput(initialBoard(data)) is the data's bucket state", () => {
  const expected: BucketsState = {
    buckets: data.buckets,
    defaultBucket: "fast",
    onlyBucketModels: true,
  }
  expect(toInput(initialBoard(data))).toEqual(expected)
})

test("a round trip keeps every bucket and item key", () => {
  const board = initialBoard(data)
  const again = stateToBoard(toInput(board), board)
  expect(Object.keys(again.columns)).toEqual(Object.keys(board.columns))
  expect(itemKeys(again)).toEqual(itemKeys(board))
  expect(again).toEqual(board)
})

test("a new bucket gets a fresh key; the old ones stay", () => {
  const board = initialBoard(data)
  const state = toInput(board)
  const next = stateToBoard(
    {
      ...state,
      buckets: [
        ...state.buckets,
        {
          name: "embed",
          modelIds: ["a"],
          strategy: "ordered",
          hedgeAfterMs: null,
        },
      ],
    },
    board
  )
  const oldKeys = Object.keys(board.columns)
  const keys = Object.keys(next.columns)
  expect(keys.slice(0, 2)).toEqual(oldKeys)
  expect(oldKeys).not.toContain(keys[2])
  expect(next.names[keys[2]!]).toBe("embed")
  expect(itemKeys(next)).not.toContain(undefined)
  expect(new Set(itemKeys(next)).size).toBe(itemKeys(next).length)
})

test("a deleted bucket disappears and the default maps by name", () => {
  const board = initialBoard(data)
  const state = toInput(board)
  const next = stateToBoard(
    { ...state, buckets: state.buckets.slice(1), defaultBucket: "fast" },
    board
  )
  expect(Object.values(next.names)).toEqual(["fast"])
  expect(next.names[next.defaultKey!]).toBe("fast")
})
