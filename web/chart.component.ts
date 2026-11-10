import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

@Component({ selector:'app-chart', standalone:true, template:'<div #chart class="chart" role="img" [attr.aria-label]="label"></div>', styles:[':host{display:block;min-width:0}.chart{width:100%;height:100%;min-height:270px}'] })
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() option: EChartsCoreOption = {};
  @Input() label = 'Gráfico de cartera';
  @ViewChild('chart') element!: ElementRef<HTMLDivElement>;
  private chart?: echarts.ECharts;
  private observer?: ResizeObserver;
  ngAfterViewInit() { this.chart=echarts.init(this.element.nativeElement,undefined,{renderer:'svg'}); this.render(); this.observer=new ResizeObserver(()=>this.chart?.resize()); this.observer.observe(this.element.nativeElement); }
  ngOnChanges() { this.render(); }
  private render() { this.chart?.setOption({animation:false,...this.option},true); }
  ngOnDestroy() { this.observer?.disconnect(); this.chart?.dispose(); }
}
