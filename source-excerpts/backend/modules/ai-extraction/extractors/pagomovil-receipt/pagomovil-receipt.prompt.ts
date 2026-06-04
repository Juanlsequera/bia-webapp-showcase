import type { ExtractionContext } from "../../core/document-extractor.interface";

export function buildPagomovilPrompt(ctx?: ExtractionContext): string {
  return `Estás analizando un comprobante de PagoMóvil de un banco venezolano.

═══════════════════════════════════════════════════════════════════
REGLA CRÍTICA #1 — EMISOR vs BENEFICIARIO (esto es lo más importante)
═══════════════════════════════════════════════════════════════════

Un comprobante tiene DOS personas:
- EMISOR: quien envía la plata (el usuario logueado en la app del banco)
- BENEFICIARIO: quien recibe la plata (a quien se le paga)

REGLA DE ORO: el campo "beneficiaryName" SOLO se extrae si está EXPLÍCITAMENTE
etiquetado. Si ves un nombre sin etiqueta clara (típicamente en el header al lado
de un avatar/ícono, o arriba del monto en frases como "El dinero fue enviado"),
ESE ES EL EMISOR, no el beneficiario → devolvé beneficiaryName=null.

ETIQUETAS VÁLIDAS para beneficiaryName (extraer solo si aparecen):
  ✅ "Nombre beneficiario"
  ✅ "Beneficiario:"
  ✅ "Destinatario:"
  ✅ "A nombre de:"
  ✅ "Titular destino" / "Titular cuenta destino"
  ✅ "Razón social" (en pagos a empresa)

PATRONES QUE INDICAN EMISOR (NO extraer como beneficiaryName):
  ❌ Nombre solo con ícono de persona/avatar arriba del recibo
  ❌ Nombre debajo de frases como "Hola, ...", "Bienvenido ..."
  ❌ Nombre arriba de "El dinero fue enviado", "Pago realizado", "Transferencia exitosa"
  ❌ Nombre en el header de la app del banco (suele ser el usuario logueado)

EN CASO DE DUDA: devolvé beneficiaryName=null. Es mucho mejor que devuelvas null
a que devuelvas el nombre del emisor por error.

Lo mismo aplica a beneficiaryPhone, beneficiaryCedula y beneficiaryBank:
solo extraé los datos del BENEFICIARIO/DESTINO. Si los datos están sin etiqueta
clara, mirá el contexto (¿están agrupados en la sección "datos del destino"?
¿están al lado de palabras como "destino", "beneficiario", "destinatario"?).

═══════════════════════════════════════════════════════════════════
LAYOUTS POR BANCO (los más comunes en Venezuela)
═══════════════════════════════════════════════════════════════════

BBVA Provincial / "Dinero Rápido" / "Pagar a Otros Bancos":
  - Header azul oscuro con "Pagar a Otros Bancos" o "Dinero Rápido"
  - ⚠⚠ Muestra el NOMBRE DEL EMISOR arriba con un avatar — ESTO NO ES EL BENEFICIARIO
  - "El dinero fue enviado" → past tense → debajo va el monto en grande
  - Logo "Dinero Rápido BBVA Provincial" en el medio
  - Sección inferior con campos del beneficiario:
    · "Banco:" → beneficiaryBank
    · "Número celular:" → beneficiaryPhone
    · "Identificación:" → beneficiaryCedula
    · "Concepto:"
    · "Fecha:"
    · "Referencia:" (9 dígitos típicamente)
  - ⚠ NO MUESTRA "Nombre beneficiario" → beneficiaryName DEBE ser null
  - issuerBank = "BBVA Provincial"

BanCaribe / "Detalle de la operación":
  - Header con logo BanCaribe (fondo negro o claro)
  - Título "Detalle de la operación"
  - Lista todos los campos explícitamente etiquetados:
    · "Monto:", "Fecha:", "Referencia:", "Descripción:"
    · "Teléfono beneficiario:" → beneficiaryPhone
    · "Cédula beneficiario:" → beneficiaryCedula
    · "Nombre beneficiario:" → beneficiaryName (este sí está etiquetado)
    · "Banco beneficiario:" → beneficiaryBank
    · "Concepto:"
  - Referencia: 12 dígitos
  - issuerBank = "BanCaribe" (también conocido como Banco del Caribe)

Banesco / "Banesco Móvil" / "BanescOnline":
  - Header verde corporativo, logo Banesco
  - Etiquetas: "Banco destino" o "Banco beneficiario"
  - "Tlf. del beneficiario" / "Tlf. beneficiario" / "Teléfono beneficiario"
  - "RIF/Cédula beneficiario" o "Cédula beneficiario"
  - "Nombre beneficiario" (cuando aparece, está etiquetado)
  - Suele NO mostrar el nombre del emisor en el comprobante
  - issuerBank = "Banesco"

Banco Mercantil / "Mercantil en Línea" / "Mercantil Móvil":
  - Header naranja/dorado con logo Mercantil
  - "Banco beneficiario", "Teléfono beneficiario", "Cédula beneficiario"
  - "Nombre beneficiario" o "Beneficiario:" suele estar etiquetado
  - issuerBank = "Mercantil"

Banco de Venezuela (BDV) / "PagomovilBDV":
  - Header rojo corporativo con logo BDV
  - Suele usar "Banco destino", "Teléfono destino", "Cédula destino", "Nombre destino"
  - Otras versiones usan "Beneficiario:" como label
  - issuerBank = "Banco de Venezuela"

Banco Bicentenario / "Bicentenario Móvil":
  - Header dorado/rojo
  - "Banco beneficiario", "Teléfono beneficiario", "Cédula beneficiario"
  - issuerBank = "Bicentenario"

Banco del Tesoro / "Tesoro Móvil":
  - Layout más sobrio, fondo claro
  - "Banco destino", "Teléfono destino", "Cédula destino"
  - issuerBank = "Banco del Tesoro"

BNC (Banco Nacional de Crédito):
  - Header con logo BNC
  - "Banco beneficiario", etiquetas estándar
  - Ofrece pago con código QR S7B
  - issuerBank = "BNC"

Banco Exterior, Activo, Banplus, 100% Banco, Plaza, Caroní, Sofitasa,
Venezolano de Crédito, Bancrecer, Fondo Común, BAV, BIV, Bancamiga, Mi Banco:
  - Layouts variados pero generalmente siguen el patrón de Banesco/Mercantil
  - Buscar etiquetas con "beneficiario", "destino", "destinatario"

═══════════════════════════════════════════════════════════════════
REGLAS DE EXTRACCIÓN GENERALES
═══════════════════════════════════════════════════════════════════

1. Primero validá que la imagen ES un comprobante de PagoMóvil. Si no lo es
   (foto del menú, selfie, captura aleatoria, foto de un producto), devolvé
   isValidReceipt=false y todo lo demás en null.

2. Para cada campo: extraé solo si está claramente identificable. PREFIERE null
   antes que adivinar — es mejor que el cliente complete a mano que pre-llenar
   con datos incorrectos.

3. Para "amount": convertí "Bs. 1.000,50" → 1000.50 (número JS, punto=miles,
   coma=decimal). NO incluir el símbolo Bs. ni la coma decimal en string —
   debe ser un número real.

4. Para "beneficiaryPhone": 11 dígitos sin espacios ni guiones (04141234567).
   Los teléfonos VE empiezan en 0414, 0424, 0412, 0416 o 0426.

5. Para "beneficiaryCedula": formato canónico:
   - "V-12345678" (venezolano)
   - "E-12345678" (extranjero)
   - "J-123456789" (jurídica/empresa)
   - "G-123456789" (gubernamental)
   - "P-12345678" (pasaporte)

6. Para "reference": solo dígitos, entre 8 y 15 caracteres.
   ⚠ BBVA Provincial usa 9 dígitos (más corta que el estándar).

7. Para "issuerBank": inferí del logo, colores o header del recibo (NO del
   "banco beneficiario", que es a DÓNDE se mandó la plata). Si no se identifica
   el banco emisor → null.

8. Para "confidence":
   - "high": ref + monto + teléfono beneficiario + cédula beneficiario están claros
   - "medium": alguno es ambiguo o falta uno crítico
   - "low": imagen borrosa, cortada, mal iluminada, o falta más de 2 campos críticos

═══════════════════════════════════════════════════════════════════
VARIANTES DE ETIQUETAS POR CAMPO (mapeo de sinónimos)
═══════════════════════════════════════════════════════════════════

beneficiaryPhone:
  "Teléfono beneficiario", "Tlf. del beneficiario", "Tlf. beneficiario",
  "Número celular", "Celular destino", "Teléfono destino", "Tlf. destino"

beneficiaryCedula:
  "Cédula beneficiario", "Identificación", "C.I.", "RIF", "Cédula/RIF",
  "RIF/Cédula", "Doc. identidad", "Documento de identidad", "Cédula destino"

beneficiaryBank:
  "Banco beneficiario", "Banco destino", "Institución destino", "Institución financiera",
  "Banco:" (solo si está en la sección de destino/beneficiario)

beneficiaryName:
  "Nombre beneficiario", "Beneficiario", "Destinatario", "A nombre de",
  "Titular destino", "Razón social"
  ⚠ NUNCA un nombre suelto sin etiqueta — eso es probablemente el emisor

reference:
  "Referencia", "Nro. Referencia", "Nº Operación", "Comprobante",
  "Nro. Transacción", "Código de aprobación", "Código operación"

amount:
  "Monto", "Bs.", "Total", "Importe", "Valor", "Monto transferido",
  "El dinero fue enviado" (cuando va seguido del monto)

date:
  "Fecha", "Fecha operación", "Fecha de operación", "Fecha de transacción"
${ctx?.expectedAmount ? `\n${"═".repeat(67)}\nCONTEXTO DEL TENANT (sanity check, NO inventar datos):\n${"═".repeat(67)}\n\nMONTO ESPERADO: ${ctx.expectedAmount} Bs.` : ""}${ctx?.expectedBeneficiaryPhone ? `\nTELÉFONO BENEFICIARIO ESPERADO: ${ctx.expectedBeneficiaryPhone}\n(Si el comprobante muestra un teléfono distinto, igual extraelo tal cual aparece)` : ""}`;
}
