"use client";

import { useActionState } from "react";
import {
  LISTING_TYPE_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  label,
  type Localised,
} from "@home88/types";

import { idleState, type ActionState } from "@/lib/form";

type Options = Array<[string, string]>;

function optionsFrom(map: Record<string, Localised>): Options {
  return Object.keys(map).map((key) => [key, label(map, key, "el")]);
}

const LISTING_OPTIONS = optionsFrom(LISTING_TYPE_LABELS);
const TYPE_OPTIONS = optionsFrom(PROPERTY_TYPE_LABELS);
/** A new property starts as a draft or active; later moves use the status actions. */
const CREATE_STATUS_OPTIONS = optionsFrom(PROPERTY_STATUS_LABELS).filter(([value]) =>
  value === "DRAFT" || value === "ACTIVE",
);

const CONDITION_OPTIONS: Options = [
  ["NEW_BUILD", "New build"],
  ["RENOVATED", "Renovated"],
  ["GOOD", "Good"],
  ["NEEDS_RENOVATION", "Needs renovation"],
  ["UNDER_CONSTRUCTION", "Under construction"],
];

const HEATING_OPTIONS: Options = [
  ["CENTRAL", "Central"],
  ["INDIVIDUAL", "Individual"],
  ["UNDERFLOOR", "Underfloor"],
  ["HEAT_PUMP", "Heat pump"],
  ["GAS", "Gas"],
  ["NONE", "None"],
  ["NOT_AVAILABLE", "Not available"],
];

const ENERGY_OPTIONS: Options = [
  ["A_PLUS", "A+"],
  ["A", "A"],
  ["B", "B"],
  ["C", "C"],
  ["D", "D"],
  ["E", "E"],
  ["F", "F"],
  ["G", "G"],
  ["NOT_AVAILABLE", "n/a"],
];

type Initial = Record<string, unknown>;

function text(initial: Initial | undefined, name: string): string {
  const value = initial?.[name];
  return value == null ? "" : String(value);
}

function checked(initial: Initial | undefined, name: string): boolean {
  return initial?.[name] === true;
}

export function PropertyForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Initial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const error = (name: string) => state.fields?.[name]?.[0];
  const id = text(initial, "id");

  return (
    <form action={formAction}>
      {id && <input type="hidden" name="id" value={id} />}

      {state.message && (
        <div
          className={state.ok ? "notice notice--ok" : "notice notice--danger"}
          role="alert"
          style={{ marginBottom: 16 }}
        >
          {state.message}
        </div>
      )}

      <div className="panel">
        <h2>Basics</h2>
        <div className="formgrid">
          <TextField name="titleEl" label="Title (GR)" defaultValue={text(initial, "titleEl")} error={error("titleEl")} required span2 />
          <TextField name="titleEn" label="Title (EN)" defaultValue={text(initial, "titleEn")} error={error("titleEn")} span2 />
          <SelectField name="listingType" label="Listing type" defaultValue={text(initial, "listingType") || "SALE"} options={LISTING_OPTIONS} error={error("listingType")} />
          <SelectField name="propertyType" label="Property type" defaultValue={text(initial, "propertyType") || "APARTMENT"} options={TYPE_OPTIONS} error={error("propertyType")} />
          {!id && <SelectField name="status" label="Status" defaultValue="DRAFT" options={CREATE_STATUS_OPTIONS} error={error("status")} />}
          <SelectField name="condition" label="Condition" defaultValue={text(initial, "condition") || "GOOD"} options={CONDITION_OPTIONS} error={error("condition")} />
          <TextField name="reference" label="Reference" defaultValue={text(initial, "reference")} hint="Leave blank to allocate automatically (H88-000001)." error={error("reference")} />
        </div>
      </div>

      <div className="panel">
        <h2>Pricing</h2>
        <div className="formgrid">
          <TextField name="price" label="Price (EUR)" defaultValue={text(initial, "price")} error={error("price")} />
          <TextField name="monthlyRent" label="Monthly rent (EUR)" defaultValue={text(initial, "monthlyRent")} error={error("monthlyRent")} />
          <TextField name="commissionRatePct" label="Commission rate (%)" defaultValue={text(initial, "commissionRatePct")} error={error("commissionRatePct")} />
          <TextField name="agentCommissionPct" label="Agent commission (%)" defaultValue={text(initial, "agentCommissionPct")} error={error("agentCommissionPct")} />
        </div>
        <CheckField name="priceOnRequest" label="Price on request" defaultChecked={checked(initial, "priceOnRequest")} />
      </div>

      <div className="panel">
        <h2>Size and layout</h2>
        <div className="formgrid">
          <TextField name="area" label="Area (m²)" defaultValue={text(initial, "area")} error={error("area")} />
          <TextField name="plotArea" label="Plot area (m²)" defaultValue={text(initial, "plotArea")} error={error("plotArea")} />
          <TextField name="builtArea" label="Built area (m²)" defaultValue={text(initial, "builtArea")} error={error("builtArea")} />
          <TextField name="bedrooms" label="Bedrooms" defaultValue={text(initial, "bedrooms")} error={error("bedrooms")} />
          <TextField name="bathrooms" label="Bathrooms" defaultValue={text(initial, "bathrooms")} error={error("bathrooms")} />
          <TextField name="wc" label="WC" defaultValue={text(initial, "wc")} error={error("wc")} />
          <TextField name="floor" label="Floor" defaultValue={text(initial, "floor")} error={error("floor")} />
          <TextField name="totalFloors" label="Total floors" defaultValue={text(initial, "totalFloors")} error={error("totalFloors")} />
          <TextField name="yearBuilt" label="Year built" defaultValue={text(initial, "yearBuilt")} error={error("yearBuilt")} />
          <TextField name="yearRenovated" label="Year renovated" defaultValue={text(initial, "yearRenovated")} error={error("yearRenovated")} />
          <SelectField name="heating" label="Heating" defaultValue={text(initial, "heating") || "NOT_AVAILABLE"} options={HEATING_OPTIONS} error={error("heating")} />
          <SelectField name="energyClass" label="Energy class" defaultValue={text(initial, "energyClass") || "NOT_AVAILABLE"} options={ENERGY_OPTIONS} error={error("energyClass")} />
        </div>
      </div>

      <div className="panel">
        <h2>Features</h2>
        <div className="checkgrid">
          <CheckField name="parking" label="Parking" defaultChecked={checked(initial, "parking")} />
          <CheckField name="storage" label="Storage" defaultChecked={checked(initial, "storage")} />
          <CheckField name="balcony" label="Balcony" defaultChecked={checked(initial, "balcony")} />
          <CheckField name="garden" label="Garden" defaultChecked={checked(initial, "garden")} />
          <CheckField name="pool" label="Pool" defaultChecked={checked(initial, "pool")} />
          <CheckField name="furnished" label="Furnished" defaultChecked={checked(initial, "furnished")} />
          <CheckField name="petsAllowed" label="Pets allowed" defaultChecked={checked(initial, "petsAllowed")} />
          <CheckField name="seaView" label="Sea view" defaultChecked={checked(initial, "seaView")} />
          <CheckField name="hasSolar" label="Solar" defaultChecked={checked(initial, "hasSolar")} />
          <CheckField name="newConstruction" label="New construction" defaultChecked={checked(initial, "newConstruction")} />
        </div>
        <div className="formgrid">
          <TextField name="parkingSpaces" label="Parking spaces" defaultValue={text(initial, "parkingSpaces")} error={error("parkingSpaces")} />
          <TextField name="balconyArea" label="Balcony area (m²)" defaultValue={text(initial, "balconyArea")} error={error("balconyArea")} />
        </div>
      </div>

      <div className="panel">
        <h2>Location</h2>
        <div className="formgrid">
          <TextField name="region" label="Region" defaultValue={text(initial, "region")} error={error("region")} />
          <TextField name="city" label="City" defaultValue={text(initial, "city")} error={error("city")} />
          <TextField name="areaName" label="Area" defaultValue={text(initial, "areaName")} error={error("areaName")} />
          <TextField name="neighborhood" label="Neighborhood" defaultValue={text(initial, "neighborhood")} error={error("neighborhood")} />
          <TextField name="address" label="Address" defaultValue={text(initial, "address")} error={error("address")} span2 />
          <TextField name="postalCode" label="Postal code" defaultValue={text(initial, "postalCode")} error={error("postalCode")} />
          <TextField name="latitude" label="Latitude" defaultValue={text(initial, "latitude")} error={error("latitude")} />
          <TextField name="longitude" label="Longitude" defaultValue={text(initial, "longitude")} error={error("longitude")} />
        </div>
      </div>

      <div className="panel">
        <h2>Descriptions</h2>
        <div className="field">
          <label htmlFor="descriptionEl">Description (GR) *</label>
          <textarea id="descriptionEl" name="descriptionEl" className="textarea" defaultValue={text(initial, "descriptionEl")} required />
          {error("descriptionEl") && <span className="error">{error("descriptionEl")}</span>}
        </div>
        <div className="field">
          <label htmlFor="descriptionEn">Description (EN)</label>
          <textarea id="descriptionEn" name="descriptionEn" className="textarea" defaultValue={text(initial, "descriptionEn")} />
          {error("descriptionEn") && <span className="error">{error("descriptionEn")}</span>}
        </div>
      </div>

      <div className="panel">
        <h2>Publishing and media</h2>
        <div className="formgrid">
          <TextField name="videoUrl" label="Video URL" defaultValue={text(initial, "videoUrl")} error={error("videoUrl")} />
          <TextField name="virtualTourUrl" label="Virtual tour URL" defaultValue={text(initial, "virtualTourUrl")} error={error("virtualTourUrl")} />
        </div>
        <CheckField name="publishedOnWebsite" label="Published on the public website" defaultChecked={checked(initial, "publishedOnWebsite")} />
        <CheckField name="featured" label="Featured" defaultChecked={checked(initial, "featured")} />
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  error,
  hint,
  required,
  span2,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={`field${span2 ? " span2" : ""}`}>
      <label htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </label>
      <input id={name} name={name} type="text" className="input" defaultValue={defaultValue} required={required} />
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function SelectField({
  name,
  label,
  defaultValue,
  options,
  error,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: Options;
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} className="select" defaultValue={defaultValue}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function CheckField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}
