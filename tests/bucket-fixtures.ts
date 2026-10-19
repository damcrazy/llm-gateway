import type {
  BucketModel,
  BucketsData,
} from "@/app/(dashboard)/apps/[id]/buckets-shared"

/** A model as the Models tab sees it: chat, healthy, free, tool-capable. */
export function bucketModel(
  overrides: Partial<BucketModel> & { id: string }
): BucketModel {
  return {
    slug: `prov/${overrides.id}`,
    name: `Model ${overrides.id}`,
    provider: "Prov",
    providerId: "prov-id",
    providerName: "Prov",
    providerSlug: "prov",
    source: "gateway",
    sharedBy: null,
    own: false,
    kind: "chat",
    capabilities: ["tools"],
    contextWindow: 128_000,
    inputPrice: 0,
    outputPrice: 0,
    status: { kind: "ok" },
    usage: null,
    ...overrides,
  }
}

/** Models tab data where every model is addable. */
export function bucketsData(
  models: BucketModel[],
  extra: Partial<BucketsData> = {}
): BucketsData {
  return {
    models,
    addable: models.map((model) => model.id),
    buckets: [],
    defaultBucket: null,
    onlyBucketModels: false,
    ownerAccess: null,
    ...extra,
  }
}
