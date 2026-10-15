# ARCA (ex AFIP) electronic invoicing

Status: built and tested with mocks, **inactive until configured** (see "Activation"). Without the `ARCA_*` variables nothing in the invoicing flow changes.

## Sources (read October 2026)

- WSFEv1 developer manual, "RG 4291 - Proyecto FE v4.7", revision of 1 Sep 2026: <https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf>
- WSAA developer manual (publication 20.2.19) and FAQ: <https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf>
- WSAA page: <https://www.afip.gob.ar/ws/documentacion/wsaa.asp>; WSFE page: <https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp>

## WSAA (authentication)

| | URL |
| --- | --- |
| Homologación | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` |
| Producción | `https://wsaa.afip.gov.ar/ws/services/LoginCms` |

The FAQ of the manual also lists the `*.arca.gov.ar` hosts; both domains are documented. We use the `afip.gov.ar` ones from the WSAA page.

- Service id in the TRA: `wsfe` (manual examples, "El servicio a acceder: wsfe"). The business web service itself is WSFEv1.
- TRA: `<loginTicketRequest version="1.0"><header><uniqueId/><generationTime/><expirationTime/></header><service>wsfe</service></loginTicketRequest>`. The manual says `source`/`destination` are optional and recommends omitting them (FAQ 10.5). `generationTime` may not be in the future or more than 24 h old (chapter 10.9); we send now-10min .. now+10min with the `-03:00` offset.
- The TRA is signed as CMS/PKCS#7 SignedData (the manual shows `openssl cms -sign` with cert + key), base64 encoded, and sent as `in0` of a SOAP `loginCms` (namespace `http://wsaa.view.sua.dvadac.desein.afip.gov`, `SOAPAction: urn:LoginCms`).
- The response is a `loginCmsReturn` carrying an escaped `loginTicketResponse` with `token`, `sign` and `expirationTime`.
- Ticket lifetime: about 12 hours (`expirationTime` is about generation + 12 h in the manual examples). FAQ 10.6: asking for a new ticket while a valid one exists is rejected ("El CEE ya posee un TA valido", window 10 min in testing / 2 min in production, may change). So the ticket is **cached in the DB** (`arca_tokens`) and reused until shortly before it expires.
- Certificates are environment specific: a homologación certificate does not work in producción and vice versa (FAQ 10.2/10.3). The certificate must be delegated to the `wsfe` service (WSASS in homologación; "delegación" in producción, FAQ 10.4).
- Clocks must be in sync (NTP) and in GMT-3 (FAQ 10.7).

## WSFEv1

| | URL |
| --- | --- |
| Homologación | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| Producción | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

SOAP 1.1, namespace `http://ar.gov.afip.dif.FEV1/`, `SOAPAction: http://ar.gov.afip.dif.FEV1/<Operation>`. Operations used: `FEDummy`, `FECompUltimoAutorizado`, `FECAESolicitar`.

`Auth` = `Token`, `Sign` (from WSAA) and `Cuit` (issuer).

### FECAESolicitar request

`FeCabReq`: `CantReg` (1), `PtoVta`, `CbteTipo`.
`FECAEDetRequest`: `Concepto` (1 products, **2 services**, 3 both), `DocTipo`, `DocNro`, `CbteDesde`/`CbteHasta` (equal for A and C), `CbteFch` (yyyymmdd, optional), `ImpTotal`, `ImpTotConc`, `ImpNeto`, `ImpOpEx`, `ImpTrib`, `ImpIVA`, `FchServDesde`/`FchServHasta`/`FchVtoPago` (**mandatory for Concepto 2 or 3**; `FchVtoPago` >= `CbteFch`), `MonId` (`PES`), `MonCotiz` (1 for PES), `CondicionIVAReceptorId`, `Iva/AlicIva{Id,BaseImp,Importe}`.

Verified rules:

- `ImpTotal = ImpTotConc + ImpOpEx + ImpNeto + sum(IVA) + ImpTrib`.
- Factura C: `ImpTotConc = 0`, `ImpOpEx = 0`, `ImpIVA = 0`, `ImpNeto` carries the subtotal, and the `Iva` array must NOT be sent.
- Factura A: `DocTipo` must be 80 (CUIT).
- Factura B individual, amount under the RG 4444 threshold: `DocTipo 99` with `DocNro 0` is accepted. Above the threshold the buyer must be identified (error 10016 otherwise).
- `CbteFch` window: for Concepto 1 up to 5 days before/after the generation date; for Concepto 2 or 3 up to 10 days. We use the invoice issue date when it is inside +-10 days of today and today otherwise.
- Amounts are doubles with 2 decimals; the service uses round half even for its tolerance checks. We send exact cent-derived values, so no rounding drift.

### Codes

- Comprobante: Factura A = 1, Factura B = 6, Factura C = 11 (manual list, validation 700).
- `DocTipo`: 80 CUIT, 96 DNI, 99 sin identificar (manual validation text refers to 80 and 99; 96 = DNI is the standard value from `FEParamGetTiposDoc`, not printed in the sections we read).
- IVA ids (`AlicIva.Id`): 5 = 21% (manual examples, "Id 5 21%").
- `CondicionIVAReceptorId` (table "Condición Frente al IVA del receptor"): 1 IVA Responsable Inscripto, 4 IVA Sujeto Exento, 5 Consumidor Final, 6 Responsable Monotributo, 7 Sujeto No Categorizado, 8 Proveedor del Exterior, 9 Cliente del Exterior, 10 IVA Liberado Ley 19.640, 13 Monotributista Social, 15 IVA No Alcanzado, 16 Monotributo Trabajador Independiente Promovido. The valid values per invoice class can be queried with `FEParamGetCondicionIvaReceptor`.

### CondicionIVAReceptorId status

Manual 4.0 (17 Mar 2025): optional from 6 Apr 2025 "hasta tanto entre en vigencia su obligatoriedad reglamentada por la RG 5616", after which ARCA rejects invoices without it (error 10246). The v4.7 manual text still says "resultará obligatorio" without a date. A third-party article (vatupdate.com) reports 1 Dec 2026 as the mandatory date, which we could not confirm on an ARCA page. We **always send** the field, which is valid both before and after the date.

### Response

`FECAESolicitarResult` -> `FeCabResp.Resultado` and `FeDetResp.FEDetResponse.Resultado`: `A` approved, `R` rejected, `P` partial (only for batches; we send one invoice per request). Approved items carry `CAE` and `CAEFchVto` (yyyymmdd). `Obs/Observaciones{Code,Msg}` are non-blocking observations on approved or rejected invoices; `Errors/Err{Code,Msg}` are request level errors; `Events/Evt` informational.

`FECompUltimoAutorizado` -> `CbteNro` (last authorized number for the PtoVta + CbteTipo; 0 when none).

`FEDummy` -> `AppServer`, `DbServer`, `AuthServer` (`OK`).

## Our rules

- Issuer `monotributo` -> always Factura C (11), no IVA breakdown, `ImpNeto = total`.
- Issuer `responsable_inscripto` -> receptor RI (or Monotributo/social/promovido, which are valid for class A) with a CUIT -> Factura A (1) with IVA 21%; everyone else -> Factura B (6) with IVA 21%.
- IVA split: `neto = round(total / 1.21)` in cents, `iva = total - neto`.
- Receptor without document (or consumidor final without data) -> `DocTipo 99`, `DocNro 0`.
- Receptor `condicionIva`: `responsable_inscripto` 1, `exento` 4, `consumidor_final` 5, `monotributo` 6, `no_categorizado` 7.

## Emission flow and reconciliation

1. Serialize all emissions in-process (numbering is sequential per PtoVta and type).
2. Mark `arca_attempted_at`, ask `FECompUltimoAutorizado`, send `FECAESolicitar` with `last + 1`.
3. On `A`, store `cae`, `cae_due_on`, number, type and PtoVta and set `arca_status = authorized`. On `R`, store the observations/errors and set `rejected`. On network/timeouts/SOAP faults set `error` with the message.
4. Reconciliation (the manual describes the timeout case and prescribes `FECompConsultar`/`FECompUltimoAutorizado`, section "Ejemplos" of FECAESolicitar): the number we asked for is stored in `arca_attempted_number` before sending. When an `error` invoice is retried we first call `FECompUltimoAutorizado`. If `last >= arca_attempted_number`, the lost attempt (or someone else) used that number: we call `FECompConsultar` for it and, if the document type and number, total and issue date match this invoice, we adopt its CAE (`CodAutorizacion`, `FchVto`) without creating a duplicate. If it does not match, the number belongs to another comprobante and we request `last + 1`.
5. An authorized invoice is never re-sent (HTTP 409).

## Unverified / needs confirmation

- Exact numeric threshold (RG 4444) above which consumer-final invoices need an identified buyer: the manual only says "monto en pesos resultante según RG4444". We do not hardcode it; ARCA rejects with 10016 and the message is shown.
- The per-class column layout (A / B / C) of the `CondicionIVAReceptorId` table did not extract unambiguously from the PDF. Our mapping follows the usual rule (A accepts 1, 6, 13, 16); `FEParamGetCondicionIvaReceptor` is the authority and ARCA answers 10243 when the id is not valid for the class.
- The 1 Dec 2026 mandatory date (third party source, see above).
- Real behavior against ARCA servers: nothing was run over the network; all tests use mocked `fetch`.

## Activation (what the client must provide)

1. Digital certificate (X.509) and its private key for the CUIT, generated at ARCA (WSASS for testing, "Administrador de Certificados Digitales" for production), delegated to the `wsfe` service.
2. A point of sale of type "Factura Electrónica - Web Services" enabled for the CUIT (number -> `ARCA_PTO_VTA`).
3. Tax condition: Monotributo or Responsable Inscripto (`ARCA_TAX_CONDITION`).
4. Environment variables: `ARCA_ENV` (`homologacion` | `produccion`), `ARCA_CUIT`, `ARCA_CERT`, `ARCA_KEY` (PEM, `\n` escaped or base64 of the PEM), `ARCA_PTO_VTA`, `ARCA_TAX_CONDITION`.
5. In Ajustes -> Facturación electrónica press "Probar conexión", test in `homologacion`, then switch to `produccion`.
