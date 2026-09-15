package app.cartero.widgetsnapshot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/*
  ── O que este arquivo protege ──

  Mesmas duas propriedades caras de `BudgetWidgetTest.kt`:

  1. Uma exceção aqui vira widget quebrado na tela inicial, ou derruba o
     launcher. Todo conteúdo inesperado — truncado, versão futura, item
     malformado — precisa terminar num estado desenhável.

  2. Com a privacidade ligada, o valor não pode aparecer NEM na tela NEM na
     acessibilidade.

  Soma-se uma terceira, específica de Invoices: `GET /invoices/actionable`
  já decidiu ordem, seleção e status. Qualquer teste que passasse mesmo com
  um `.sortedBy`/`.filter` acrescentado aqui estaria protegendo a coisa
  errada — por isso os testes de ordem usam entradas DELIBERADAMENTE fora de
  ordem alfabética/cronológica.
*/
@RunWith(RobolectricTestRunner::class)
class InvoicesReaderTest {

  private fun invoiceJson(
    bankName: String,
    status: String,
    actionDate: String,
    totalCents: String,
  ) =
    """{"bankName":"$bankName","status":"$status","actionDate":"$actionDate","totalAmountCents":$totalCents}"""

  private fun readyJson(
    version: Int = 2,
    hideAmounts: Boolean = true,
    invoices: String = listOf(
      invoiceJson("Banco C", "OVERDUE", "2026-08-10", "45000"),
      invoiceJson("Banco A", "CLOSED", "2026-09-25", "22050"),
      invoiceJson("Banco B", "OPEN", "2026-09-21", "31100"),
    ).joinToString(",", "[", "]"),
  ) = """
    {
      "version": $version,
      "state": "ready",
      "generatedAt": "2026-09-15T12:00:00.000Z",
      "ownerId": "user-a",
      "privacy": { "hideAmounts": $hideAmounts },
      "invoices": $invoices
    }
  """.trimIndent()

  /* ────────────── K1–K3: os estados válidos ────────────── */

  @Test
  fun `K1 - READY valido com 3 invoices e lido`() {
    val state = InvoicesReader.parse(readyJson())

    assertTrue(state is InvoicesState.Ready)
    val ready = state as InvoicesState.Ready
    assertEquals(3, ready.invoices.size)
    assertTrue(ready.hideAmounts)
  }

  @Test
  fun `K2 - READY vazio e valido`() {
    val state = InvoicesReader.parse(readyJson(invoices = "[]"))

    assertTrue(state is InvoicesState.Ready)
    assertEquals(0, (state as InvoicesState.Ready).invoices.size)
  }

  @Test
  fun `K3 - signedOut valido e lido`() {
    val state = InvoicesReader.parse(
      """{"version":2,"state":"signedOut","generatedAt":"2026-09-15T12:00:00.000Z"}""",
    )

    assertEquals(InvoicesState.SignedOut, state)
  }

  /* ────────────── K4–K8: tudo o mais é neutro, nunca crash ────────────── */

  @Test
  fun `K4 - arquivo ausente nao quebra`() {
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(null))
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(""))
  }

  @Test
  fun `K5 - JSON corrompido nao quebra`() {
    assertEquals(
      InvoicesState.Unavailable,
      InvoicesReader.parse("""{"version":1,"state":"rea"""),
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse("[]"))
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse("texto solto"))
  }

  @Test
  fun `K6 - versao desconhecida nunca e lida como V2`() {
    // version=1 (M6, pre-M6.2, sem totalAmountCents obrigatorio) tambem
    // conta como desconhecida agora — o SHAPE mudou, entao um leitor V2
    // nao pode aceitar um payload V1 como se fosse igual.
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(readyJson(version = 1)))
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(readyJson(version = 3)))
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(readyJson(version = 0)))
  }

  @Test
  fun `K7 - READY malformado e recusado`() {
    val semPrivacy = readyJson().replace(""""privacy": { "hideAmounts": true },""", "")
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(semPrivacy))

    val semInvoices = """{"version":2,"state":"ready","generatedAt":"2026-09-15T12:00:00.000Z","privacy":{"hideAmounts":true}}"""
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(semInvoices))

    val semGeneratedAt = readyJson().replace(
      """"generatedAt": "2026-09-15T12:00:00.000Z",""",
      "",
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(semGeneratedAt))
  }

  @Test
  fun `K8 - status desconhecido invalida o snapshot inteiro`() {
    val comStatusInvalido = readyJson(
      invoices = "[" + invoiceJson("Banco X", "PAID", "2026-09-20", "1000") + "]",
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(comStatusInvalido))

    val comStatusArbitrario = readyJson(
      invoices = "[" + invoiceJson("Banco X", "QUALQUER", "2026-09-20", "1000") + "]",
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(comStatusArbitrario))
  }

  /* ────────────── K9: civil date inválida ────────────── */

  @Test
  fun `K9 - actionDate invalida invalida o snapshot inteiro`() {
    for (dataInvalida in listOf("2026-13-01", "2026-02-30", "not-a-date", "2026-9-1", "")) {
      val comDataInvalida = readyJson(
        invoices = "[" + invoiceJson("Banco X", "OPEN", dataInvalida, "1000") + "]",
      )
      assertEquals(
        "data '$dataInvalida' deveria invalidar",
        InvoicesState.Unavailable,
        InvoicesReader.parse(comDataInvalida),
      )
    }
  }

  @Test
  fun `2026-02-29 e valido em ano bissexto, invalido em ano comum`() {
    val bissexto = readyJson(
      invoices = "[" + invoiceJson("Banco X", "OPEN", "2028-02-29", "1000") + "]",
    )
    assertTrue(InvoicesReader.parse(bissexto) is InvoicesState.Ready)

    val naoBissexto = readyJson(
      invoices = "[" + invoiceJson("Banco X", "OPEN", "2026-02-29", "1000") + "]",
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(naoBissexto))
  }

  /* ────────────── K10: surface fechada ────────────── */

  @Test
  fun `K10 - campos extras da resposta crua nao viram dependencia do presenter`() {
    val comExtras = """
      {
        "version": 2,
        "state": "ready",
        "generatedAt": "2026-09-15T12:00:00.000Z",
        "ownerId": "user-a",
        "privacy": { "hideAmounts": true },
        "invoices": [
          {
            "bankName": "Banco X",
            "status": "OPEN",
            "actionDate": "2026-09-20",
            "totalAmountCents": 1500,
            "ownAmountCents": 1000,
            "closeDate": "2026-09-03",
            "dueDate": "2026-09-20",
            "bankId": "internal",
            "invoiceId": "internal-2",
            "totalAmount": 999.99
          }
        ]
      }
    """.trimIndent()

    val state = InvoicesReader.parse(comExtras) as InvoicesState.Ready
    val item = state.invoices[0]

    // `InvoiceItem` só tem estes 4 campos — `ownAmountCents` (M6.2) é
    // deliberadamente um dos extras que não sobrevive: o backend o envia,
    // mas nenhum código instalado do widget o lê ou persiste.
    assertEquals("Banco X", item.bankName)
    assertEquals("OPEN", item.status)
    assertEquals("2026-09-20", item.actionDate)
    assertEquals(1500L, item.totalAmountCents)
  }

  /* ────────────── K42-K44 (M6.2): totalAmountCents obrigatório, ownAmountCents nunca persistido ────────────── */

  @Test
  fun `K42 - totalAmountCents ausente invalida o snapshot inteiro`() {
    val semTotal = readyJson(
      invoices = "[" +
        """{"bankName":"X","status":"OPEN","actionDate":"2026-09-20"}""" +
        "]",
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(semTotal))
  }

  @Test
  fun `K43 - totalAmountCents nao-inteiro invalida`() {
    val comFracionario = readyJson(
      invoices = "[" +
        """{"bankName":"X","status":"OPEN","actionDate":"2026-09-20","totalAmountCents":12.5}""" +
        "]",
    )
    assertEquals(InvoicesState.Unavailable, InvoicesReader.parse(comFracionario))
  }

  @Test
  fun `K44 - ownAmountCents presente no raw JSON nunca e lido nem persistido`() {
    // Mutation guard (F1): se `InvoiceItem` algum dia ganhar de volta um
    // campo `ownAmountCents`, este teste precisa ser atualizado explicitamente
    // — hoje a classe não tem esse campo, então nem compilaria referenciá-lo.
    val raw = readyJson(
      invoices = "[" +
        """{"bankName":"Banco X","status":"OPEN","actionDate":"2026-09-20","totalAmountCents":100000,"ownAmountCents":70000}""" +
        "]",
    )
    val state = InvoicesReader.parse(raw) as InvoicesState.Ready
    val item = state.invoices[0]

    assertEquals(100000L, item.totalAmountCents)
  }
}

@RunWith(RobolectricTestRunner::class)
class InvoicesWidgetPresenterTest {

  private val generatedAt = 1_789_819_200_000L // 2026-09-15T12:00:00Z

  private fun invoice(
    bankName: String = "Banco X",
    status: String = "OPEN",
    actionDate: String = "2026-09-20",
    totalCents: Long = 1000,
  ) = InvoiceItem(bankName, status, actionDate, totalCents)

  private fun ready(
    invoices: List<InvoiceItem> = listOf(invoice()),
    hideAmounts: Boolean = true,
  ) = InvoicesState.Ready(invoices, hideAmounts, generatedAt)

  /* ────────────── ordem (§11, W1) ────────────── */

  @Test
  fun `ordem e preservada exatamente como recebida - C A B permanece C A B`() {
    val invoices = listOf(
      invoice(bankName = "Banco C", status = "OVERDUE", actionDate = "2026-08-10"),
      invoice(bankName = "Banco A", status = "CLOSED", actionDate = "2026-09-25"),
      invoice(bankName = "Banco B", status = "OPEN", actionDate = "2026-09-21"),
    )
    val model = InvoicesWidgetPresenter.present(ready(invoices), generatedAt)
      as InvoicesWidgetUiModel.Ready

    // Nem alfabética (A,B,C) nem por urgência (OVERDUE,CLOSED,OPEN) — a
    // ORDEM DE ENTRADA, sem exceção.
    assertEquals(listOf("Banco C", "Banco A", "Banco B"), model.rows.map { it.bankName })
  }

  /* ────────────── K41 (§41): cap de apresentação, sem reordenar ────────────── */

  @Test
  fun `mais de 3 invoices sao cortadas para os 3 PRIMEIROS na ordem recebida`() {
    val invoices = listOf(
      invoice(bankName = "D", actionDate = "2026-09-01"),
      invoice(bankName = "A", actionDate = "2026-09-02"),
      invoice(bankName = "C", actionDate = "2026-09-03"),
      invoice(bankName = "B", actionDate = "2026-09-04"),
    )
    val model = InvoicesWidgetPresenter.present(ready(invoices), generatedAt)
      as InvoicesWidgetUiModel.Ready

    // Corta em 3 SEM reordenar antes — "B" (4º na entrada) fica de fora,
    // não o de actionDate mais distante.
    assertEquals(listOf("D", "A", "C"), model.rows.map { it.bankName })
  }

  /* ────────────── K20–K22: status copy ────────────── */

  @Test
  fun `K20 - OVERDUE vira Venceu DDMM`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(status = "OVERDUE", actionDate = "2026-09-10"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertEquals("Venceu 10/09", model.rows[0].statusText)
  }

  @Test
  fun `K21 - CLOSED vira Vence DDMM`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(status = "CLOSED", actionDate = "2026-09-20"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertEquals("Vence 20/09", model.rows[0].statusText)
  }

  @Test
  fun `K22 - OPEN vira Fecha DDMM`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(status = "OPEN", actionDate = "2026-09-25"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertEquals("Fecha 25/09", model.rows[0].statusText)
  }

  @Test
  fun `status copy nao depende do relogio atual - W2 W3`() {
    // Um snapshot de HORAS atrás continua com o MESMO texto — nunca "vence
    // hoje"/"em 2 dias", que exigiriam comparar actionDate com `now`.
    val model1 = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(status = "OVERDUE", actionDate = "2026-09-10"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready
    val model2 = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(status = "OVERDUE", actionDate = "2026-09-10"))),
      generatedAt + 100 * 3_600_000L, // 100h depois
    ) as InvoicesWidgetUiModel.Ready

    assertEquals(model1.rows[0].statusText, model2.rows[0].statusText)
  }

  /* ────────────── K23–K26: civil date ────────────── */

  @Test
  fun `K23 - 2026-09-01 vira 01-09`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(actionDate = "2026-09-01"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertTrue(model.rows[0].statusText.endsWith("01/09"))
  }

  @Test
  fun `K24 - virada de mes preserva o dia`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(actionDate = "2026-09-30"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertTrue(model.rows[0].statusText.endsWith("30/09"))
  }

  @Test
  fun `K25 - virada de ano preserva o dia`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(actionDate = "2025-12-31"))),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertTrue(model.rows[0].statusText.endsWith("31/12"))
  }

  @Test
  fun `K26 - timezone do device nao desloca o dia - W4`() {
    val original = java.util.TimeZone.getDefault()
    try {
      // Fuso extremo (UTC+14): se houvesse conversão Instant/Date, 01/09
      // deslocaria para 31/08 ou 02/09 conforme o fuso.
      java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Pacific/Kiritimati"))

      val model = InvoicesWidgetPresenter.present(
        ready(listOf(invoice(actionDate = "2026-09-01"))),
        generatedAt,
      ) as InvoicesWidgetUiModel.Ready

      assertTrue(model.rows[0].statusText.endsWith("01/09"))
    } finally {
      java.util.TimeZone.setDefault(original)
    }
  }

  /* ────────────── K11–K15: money ────────────── */

  @Test
  fun `K11 K12 K13 K14 - centavos formatam em BRL sem ponto flutuante`() {
    val casos = mapOf(
      0L to "R$ 0,00",
      1L to "R$ 0,01",
      12345L to "R$ 123,45",
      184320077L to "R$ 1.843.200,77",
    )

    for ((cents, esperado) in casos) {
      assertEquals(
        esperado,
        InvoicesWidgetPresenter.formatCents(cents).replace(' ', ' '),
      )
    }
  }

  @Test
  fun `K15 - dinheiro nao usa Double como authority - W6`() {
    /*
      Discriminante real: BigDecimal.valueOf(cents,2) e Double(cents)/100
      produzem o MESMO texto para inteiros normais — a imprecisão de Double
      só aparece em valores de ponto flutuante convertidos de volta, não em
      Long puro dividido por 100 dentro do range de um Double. Reportamos
      isso honestamente: para os campos `*Cents: Long`, os dois caminhos são
      observacionalmente equivalentes sob NumberFormat, IGUAL ao M3 (BUD-P4).
      A authority ainda é BigDecimal por princípio de design compartilhado
      com o Budget, não porque um teste consiga discriminar aqui.
    */
    assertEquals("R$ 446,24", InvoicesWidgetPresenter.formatCents(44624L).replace(' ', ' '))
  }

  @Test
  fun `M6_2 - amountText formata totalAmountCents, o unico campo monetario do modelo`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(totalCents = 100000)), hideAmounts = false),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertEquals("R$ 1.000,00", model.rows[0].amountText.replace(' ', ' '))
  }

  @Test
  fun `M6_2 - accessibility visivel tambem usa totalAmountCents`() {
    val model = InvoicesWidgetPresenter.present(
      ready(
        listOf(invoice(bankName = "Nubank", totalCents = 100000)),
        hideAmounts = false,
      ),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertTrue(model.rows[0].description.contains("1.000,00"))
  }

  /* ────────────── K16–K19: privacidade ────────────── */

  @Test
  fun `K16 - hide=true mascara visualmente`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(totalCents = 44624)), hideAmounts = true),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertEquals(InvoicesWidgetPresenter.MASK, model.rows[0].amountText)
  }

  @Test
  fun `K17 - hide=true NAO expoe o valor via accessibility - W5 W12`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(bankName = "Nubank", totalCents = 44624)), hideAmounts = true),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    val description = model.rows[0].description
    assertFalse(description.contains("446"))
    assertFalse(description.contains("44624"))
    assertFalse(description.contains("R$"))
    assertTrue(description.contains("oculto"))
    // A descrição ainda identifica banco e prazo — só o valor é escondido.
    assertTrue(description.contains("Nubank"))
  }

  @Test
  fun `K18 - hide=false formata BRL`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(totalCents = 44624)), hideAmounts = false),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertEquals("R$ 446,24", model.rows[0].amountText.replace(' ', ' '))
  }

  @Test
  fun `K19 - hide=false a accessibility contem o valor correto`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(bankName = "Nubank", totalCents = 44624)), hideAmounts = false),
      generatedAt,
    ) as InvoicesWidgetUiModel.Ready

    assertTrue(model.rows[0].description.contains("446,24"))
    assertTrue(model.rows[0].description.contains("Nubank"))
  }

  /* ────────────── K27–K30: empty / neutral ────────────── */

  @Test
  fun `K27 - READY vazio mostra a mensagem de nenhuma fatura, nao erro - W8`() {
    val model = InvoicesWidgetPresenter.present(ready(emptyList()), generatedAt)
      as InvoicesWidgetUiModel.Ready

    assertEquals(InvoicesWidgetPresenter.EMPTY_MESSAGE, model.emptyMessage)
    assertTrue(model.rows.isEmpty())
    assertFalse(model.emptyMessage!!.contains("rro")) // nem "Erro" nem "erro"
  }

  @Test
  fun `K28 - signedOut pede para abrir o Cartero para entrar`() {
    val model = InvoicesWidgetPresenter.present(InvoicesState.SignedOut, generatedAt)

    assertTrue(model is InvoicesWidgetUiModel.SignedOut)
    val out = model as InvoicesWidgetUiModel.SignedOut
    assertEquals("CARTERO", out.title)
    assertEquals("Abra o Cartero para entrar", out.message)
  }

  @Test
  fun `K29 K30 - ausente e corrompido pedem para abrir o Cartero para atualizar`() {
    val model = InvoicesWidgetPresenter.present(InvoicesState.Unavailable, generatedAt)

    assertTrue(model is InvoicesWidgetUiModel.Unavailable)
    val indisponivel = model as InvoicesWidgetUiModel.Unavailable
    assertEquals("Abra o Cartero para atualizar", indisponivel.message)
    assertFalse(indisponivel.message.contains("expirou"))
    assertFalse(indisponivel.message.contains("sessão"))
  }

  /* ────────────── K31–K35: stale (mesma política do Budget) ────────────── */

  @Test
  fun `K31 - abaixo de 6h nao ha rotulo`() {
    val cincoHoras = generatedAt + (5 * 3_600_000L)
    assertNull(InvoicesWidgetPresenter.staleTextFor(generatedAt, cincoHoras))
  }

  @Test
  fun `K32 - a partir de 6h o rotulo aparece`() {
    val seisHoras = generatedAt + (6 * 3_600_000L)
    assertEquals(
      "Atualizado há 6h",
      InvoicesWidgetPresenter.staleTextFor(generatedAt, seisHoras),
    )
  }

  @Test
  fun `K33 - 23h conta em horas`() {
    val vinteETresHoras = generatedAt + (23 * 3_600_000L)
    assertEquals(
      "Atualizado há 23h",
      InvoicesWidgetPresenter.staleTextFor(generatedAt, vinteETresHoras),
    )
  }

  @Test
  fun `K34 - 24h vira data absoluta`() {
    val doisDias = generatedAt + (48 * 3_600_000L)
    val texto = InvoicesWidgetPresenter.staleTextFor(generatedAt, doisDias)!!

    assertTrue(texto.startsWith("Atualizado em "))
    assertFalse(texto.contains("h"))
  }

  @Test
  fun `K35 - relogio atrasado nao produz rotulo negativo`() {
    val antes = generatedAt - 3_600_000L
    assertNull(InvoicesWidgetPresenter.staleTextFor(generatedAt, antes))
  }

  @Test
  fun `stale e a MESMA authority do Budget - reutilizada, nao duplicada`() {
    assertEquals(
      BudgetWidgetPresenter.staleTextFor(generatedAt, generatedAt + 7 * 3_600_000L),
      InvoicesWidgetPresenter.staleTextFor(generatedAt, generatedAt + 7 * 3_600_000L),
    )
  }

  /* ────────────── W3: stale não muda status ────────────── */

  @Test
  fun `snapshot antigo nao transforma CLOSED em OVERDUE localmente - W3 §27`() {
    val model = InvoicesWidgetPresenter.present(
      ready(listOf(invoice(status = "CLOSED", actionDate = "2026-08-01"))),
      generatedAt + 100 * 3_600_000L, // bem depois do actionDate persistido
    ) as InvoicesWidgetUiModel.Ready

    // Continua "Vence", nunca vira "Venceu" por conta própria.
    assertTrue(model.rows[0].statusText.startsWith("Vence "))
    assertFalse(model.rows[0].statusText.startsWith("Venceu"))
  }
}
